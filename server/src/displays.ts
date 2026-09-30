import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  DisplayAccessInput,
  DisplayApprove,
  DisplayClaim,
  DisplayInput,
  PAIR_CODE_ALPHABET,
  PAIR_CODE_LENGTH,
  formatPairCode,
  normalizePairCode,
  type DisplayAccess,
  type DisplayDTO,
  type DisplaysDTO,
  type DisplayStatus,
  type NewDisplayDTO,
} from '@hearthboard/shared';
import type { Auth } from './auth';
import { getSetting, setSetting, type DB } from './db';
import type { LiveHub } from './live';
import { hashToken, HttpError } from './util';

/** preHandler for everything a wall display reads. */
export type DisplayGuard = Displays['guard'];

export interface DisplayRow {
  id: string;
  name: string;
  /** The cookie's hash. Null while a pairing link waits to be opened. */
  token_hash: string | null;
  /** Hash of the one-time secret in a pairing link. */
  claim_hash: string | null;
  created_at: number;
  last_seen: number;
  approved: 0 | 1;
  /** What a screen shows while it waits for an admin to approve it. */
  code: string | null;
  /** When the code, or an unopened pairing link, runs out. */
  expires_at: number | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The paired screen making the request; set by `displays.guard`. */
    display: DisplayRow | null;
  }
}

const COOKIE = 'hb_display';
const COOKIE_MAX_AGE_S = 10 * 365 * 24 * 3600;
const CODE_TTL_MS = 10 * 60_000;
const LINK_TTL_MS = 24 * 3600_000;
/** Screens waiting to be approved at once, so the list can't be flooded. */
const MAX_PENDING = 20;
/**
 * Codes one address may have waiting, so one device can't take every place. Screens behind a
 * reverse proxy (without HEARTHBOARD_TRUST_PROXY) all share the proxy's address, so this leaves
 * room for a whole household pairing at once.
 */
const MAX_PENDING_PER_ADDRESS = 10;
/**
 * A waiting screen asks every few seconds whether it has been approved. A code nobody has asked
 * about for this long belongs to a screen that is gone (closed, or it lost its cookie), and makes
 * room for new ones. Codes that are still being shown are never taken away.
 */
const ABANDONED_MS = 30_000;
/** How often a waiting screen's polls are written down. */
const PENDING_SEEN_MS = 1_000;

const newCode = () =>
  Array.from(
    { length: PAIR_CODE_LENGTH },
    () => PAIR_CODE_ALPHABET[crypto.randomInt(PAIR_CODE_ALPHABET.length)],
  ).join('');

const newToken = () => crypto.randomBytes(32).toString('base64url');

/**
 * Screens that may show boards without anyone signing in. An admin pairs each one once (with a
 * code shown on the screen, or a one-time link); after that its cookie is its ticket.
 */
export class Displays {
  constructor(
    private db: DB,
    private auth: Auth,
    private live: LiveHub,
  ) {}

  access(): DisplayAccess {
    return getSetting<DisplayAccess>(this.db, 'displayAccess') === 'open' ? 'open' : 'paired';
  }

  /** The paired screen a request comes from, if any. */
  current(req: FastifyRequest): DisplayRow | null {
    const token = req.cookies[COOKIE];
    if (!token) return null;
    const row = this.db
      .prepare('SELECT * FROM displays WHERE token_hash = ? AND approved = 1')
      .get(hashToken(token)) as DisplayRow | undefined;
    if (!row) return null;
    const now = Date.now();
    if (now - row.last_seen > 3600_000) {
      this.db.prepare('UPDATE displays SET last_seen = ? WHERE id = ?').run(now, row.id);
    }
    return row;
  }

  /** Signed in, a paired screen, or the household lets any device show boards. */
  allows(req: FastifyRequest): boolean {
    return !!this.auth.currentUser(req) || !!this.current(req) || this.access() === 'open';
  }

  /** 401 unless the request is from a signed-in person, a paired screen, or access is open. */
  guard = async (req: FastifyRequest, reply: FastifyReply) => {
    req.user = this.auth.currentUser(req);
    req.display = req.user ? null : this.current(req);
    if (!req.user && !req.display && this.access() !== 'open')
      return reply.code(401).send({ error: 'Pair this screen first.' });
  };

  private prune(now = Date.now()) {
    this.db
      .prepare('DELETE FROM displays WHERE expires_at IS NOT NULL AND expires_at < ?')
      .run(now);
  }

  /**
   * The code this request's screen is showing, if it is still waiting to be approved. Asking
   * keeps the code alive (see ABANDONED_MS).
   */
  private pending(req: FastifyRequest): DisplayRow | null {
    const token = req.cookies[COOKIE];
    if (!token) return null;
    const now = Date.now();
    const row = this.db
      .prepare('SELECT * FROM displays WHERE token_hash = ? AND approved = 0 AND expires_at > ?')
      .get(hashToken(token), now) as DisplayRow | undefined;
    if (!row) return null;
    if (now - row.last_seen >= PENDING_SEEN_MS) {
      this.db.prepare('UPDATE displays SET last_seen = ? WHERE id = ?').run(now, row.id);
      row.last_seen = now;
    }
    return row;
  }

  /** Drop codes whose screens stopped asking about them. */
  private pruneAbandoned(now = Date.now()) {
    this.db
      .prepare('DELETE FROM displays WHERE approved = 0 AND code IS NOT NULL AND last_seen < ?')
      .run(now - ABANDONED_MS);
  }

  private dto(r: DisplayRow): DisplayDTO {
    const waiting = r.token_hash === null;
    return {
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      lastSeen: waiting ? null : r.last_seen,
      waiting,
    };
  }

  private approvedById(id: string): DisplayRow {
    const row = this.db.prepare('SELECT * FROM displays WHERE id = ? AND approved = 1').get(id) as
      DisplayRow | undefined;
    if (!row) throw new HttpError(404, 'No such screen');
    return row;
  }

  private setCookie(reply: FastifyReply, token: string) {
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: COOKIE_MAX_AGE_S,
    });
  }

  register(app: FastifyInstance, auth: Auth) {
    app.decorateRequest('display', null);
    const admin = { preHandler: auth.adminGuard };

    // ---- the screen's side: public, it has nothing to sign in with yet ----

    app.get('/api/displays/me', async (req, reply): Promise<DisplayStatus> => {
      reply.header('cache-control', 'no-store');
      const signedIn = !!this.auth.currentUser(req);
      const display = signedIn ? null : this.current(req);
      const waiting = signedIn || display ? null : this.pending(req);
      const access = this.access();
      return {
        allowed: signedIn || !!display || access === 'open',
        access,
        name: display?.name ?? null,
        pending: waiting
          ? { code: formatPairCode(waiting.code!), expiresAt: waiting.expires_at! }
          : null,
      };
    });

    // A screen asks for a code to show. It gets its cookie now, but the cookie only counts once
    // an admin approves the code.
    app.post('/api/displays/pair', async (req, reply) => {
      reply.header('cache-control', 'no-store');
      const now = Date.now();
      this.prune(now);
      // A screen that reloads keeps the code it already has.
      const waiting = this.pending(req);
      if (waiting) return { code: formatPairCode(waiting.code!), expiresAt: waiting.expires_at! };
      if (this.current(req)) throw new HttpError(409, 'This screen is already paired.');

      // Codes are never taken from a screen that is still showing one: that is what made
      // screens sharing an address (behind a reverse proxy) replace each other's codes every
      // few seconds. Only codes nobody has asked about for a while make room. One device (say,
      // a script on the network) can hold at most MAX_PENDING_PER_ADDRESS places, and a screen
      // that lost its cookie still gets a new code; its old one lapses by itself.
      this.pruneAbandoned(now);
      const count = (sql: string, ...args: unknown[]) =>
        (this.db.prepare(sql).get(...args) as { n: number }).n;
      if (
        count(
          'SELECT COUNT(*) AS n FROM displays WHERE approved = 0 AND requested_by = ?',
          req.ip,
        ) >= MAX_PENDING_PER_ADDRESS
      )
        throw new HttpError(
          429,
          'Too many screens from this address are waiting to be paired. Pair one of them, or try again in a minute.',
        );
      if (count('SELECT COUNT(*) AS n FROM displays WHERE approved = 0') >= MAX_PENDING)
        throw new HttpError(429, 'Too many screens are waiting to be paired. Try again in a bit.');

      let code = newCode();
      while (this.db.prepare('SELECT 1 FROM displays WHERE code = ?').get(code)) code = newCode();
      const token = newToken();
      const expiresAt = now + CODE_TTL_MS;
      this.db
        .prepare(
          `INSERT INTO displays (id, name, token_hash, created_at, last_seen, approved, code, expires_at, requested_by)
           VALUES (?, '', ?, ?, ?, 0, ?, ?, ?)`,
        )
        .run(
          crypto.randomBytes(8).toString('hex'),
          hashToken(token),
          now,
          now,
          code,
          expiresAt,
          req.ip,
        );
      this.setCookie(reply, token);
      return { code: formatPairCode(code), expiresAt };
    });

    // Opening a pairing link: the page trades the link's one-time secret for a cookie. The
    // secret travels in the URL's #fragment and this POST, never in a logged request URL.
    app.post('/api/displays/claim', async (req, reply) => {
      const { token } = DisplayClaim.parse(req.body);
      const now = Date.now();
      this.prune(now);
      const row = this.db
        .prepare(
          'SELECT * FROM displays WHERE claim_hash = ? AND approved = 1 AND token_hash IS NULL',
        )
        .get(hashToken(token)) as DisplayRow | undefined;
      if (!row)
        throw new HttpError(
          404,
          'That pairing link has run out or was already used. Ask an admin for a new one.',
        );
      const cookie = newToken();
      this.db
        .prepare(
          'UPDATE displays SET token_hash = ?, claim_hash = NULL, expires_at = NULL, last_seen = ? WHERE id = ?',
        )
        .run(hashToken(cookie), now, row.id);
      this.setCookie(reply, cookie);
      return { ok: true };
    });

    // ---- the admin's side ----

    app.get('/api/displays', admin, async (): Promise<DisplaysDTO> => {
      this.prune();
      const rows = this.db
        .prepare('SELECT * FROM displays WHERE approved = 1 ORDER BY created_at, rowid')
        .all() as DisplayRow[];
      return { access: this.access(), displays: rows.map((r) => this.dto(r)) };
    });

    app.put('/api/displays/access', admin, async (req) => {
      const { access } = DisplayAccessInput.parse(req.body);
      setSetting(this.db, 'displayAccess', access);
      // Take effect now: screens that only got in because it was open are shown the door.
      if (access === 'paired') this.live.disconnect((a) => !a.displayId && !a.signedIn);
      return { access };
    });

    // The admin types the code a screen is showing and names the screen.
    app.post('/api/displays/approve', admin, async (req): Promise<DisplayDTO> => {
      const { code, name } = DisplayApprove.parse(req.body);
      const now = Date.now();
      this.prune(now);
      const row = this.db
        .prepare('SELECT * FROM displays WHERE code = ? AND approved = 0')
        .get(normalizePairCode(code)) as DisplayRow | undefined;
      if (!row)
        throw new HttpError(
          404,
          "That code isn't right, or it has run out. Check the screen for its current code.",
        );
      this.db
        .prepare(
          'UPDATE displays SET approved = 1, name = ?, code = NULL, expires_at = NULL, last_seen = ? WHERE id = ?',
        )
        .run(name, now, row.id);
      return this.dto(this.approvedById(row.id));
    });

    // For people who'd rather use a link than a code (and for tests): make the screen first,
    // then open the one-time link on it.
    app.post('/api/displays', admin, async (req): Promise<NewDisplayDTO> => {
      const { name } = DisplayInput.parse(req.body);
      const now = Date.now();
      const token = newToken();
      const id = crypto.randomBytes(8).toString('hex');
      const expiresAt = now + LINK_TTL_MS;
      this.db
        .prepare(
          `INSERT INTO displays (id, name, claim_hash, created_at, last_seen, approved, expires_at)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(id, name, hashToken(token), now, now, expiresAt);
      return {
        ...this.dto(this.approvedById(id)),
        url: `${req.protocol}://${req.host}/pair#token=${token}`,
        expiresAt,
      };
    });

    app.patch<{ Params: { id: string } }>('/api/displays/:id', admin, async (req) => {
      const { name } = DisplayInput.parse(req.body);
      this.approvedById(req.params.id);
      this.db.prepare('UPDATE displays SET name = ? WHERE id = ?').run(name, req.params.id);
      return this.dto(this.approvedById(req.params.id));
    });

    app.delete<{ Params: { id: string } }>('/api/displays/:id', admin, async (req) => {
      const row = this.approvedById(req.params.id);
      this.db.prepare('DELETE FROM displays WHERE id = ?').run(row.id);
      this.live.disconnect((a) => a.displayId === row.id);
      return { ok: true };
    });
  }
}
