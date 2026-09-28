import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getSetting, setSetting, type DB } from './db';

const COOKIE = 'hb_session';
const SESSION_TTL_MS = 365 * 24 * 3600 * 1000;
const PinBody = z.object({ pin: z.string().regex(/^\d{4,12}$/, 'PIN must be 4-12 digits') });

interface PinHash {
  salt: string;
  hash: string;
}

function hashPin(pin: string, salt = crypto.randomBytes(16).toString('base64url')): PinHash {
  const hash = crypto.scryptSync(pin, salt, 32).toString('base64url');
  return { salt, hash };
}

function checkPin(pin: string, stored: PinHash): boolean {
  const { hash } = hashPin(pin, stored.salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(stored.hash));
}

export class Auth {
  private failures = new Map<string, { count: number; until: number }>();

  constructor(
    private db: DB,
    envPin: string | null,
  ) {
    if (envPin) setSetting(db, 'adminPin', hashPin(envPin));
    if (!getSetting<string>(db, 'ingestToken')) this.rotateIngestToken();
  }

  pinSet(): boolean {
    return !!getSetting<PinHash>(this.db, 'adminPin');
  }

  ingestToken(): string {
    return getSetting<string>(this.db, 'ingestToken')!;
  }

  rotateIngestToken(): string {
    const token = crypto.randomBytes(24).toString('base64url');
    setSetting(this.db, 'ingestToken', token);
    return token;
  }

  checkIngestToken(header: string | undefined): boolean {
    const given = header?.replace(/^Bearer\s+/i, '').trim() ?? '';
    const expected = this.ingestToken();
    return (
      given.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
    );
  }

  isAuthenticated(req: FastifyRequest): boolean {
    const token = req.cookies[COOKIE];
    if (!token) return false;
    const row = this.db.prepare('SELECT last_seen FROM sessions WHERE token = ?').get(token) as
      | { last_seen: number }
      | undefined;
    if (!row) return false;
    const now = Date.now();
    if (now - row.last_seen > SESSION_TTL_MS) {
      this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return false;
    }
    if (now - row.last_seen > 3600_000) {
      this.db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(now, token);
    }
    return true;
  }

  /** preHandler guarding admin routes. */
  guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!this.isAuthenticated(req)) {
      return reply.code(401).send({ error: 'Log in with the admin PIN first.' });
    }
  };

  private startSession(reply: FastifyReply) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db.prepare('INSERT INTO sessions (token, created_at, last_seen) VALUES (?, ?, ?)').run(token, now, now);
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS / 1000,
    });
  }

  register(app: FastifyInstance) {
    app.get('/api/auth/status', async (req) => ({
      authenticated: this.isAuthenticated(req),
      pinSet: this.pinSet(),
    }));

    app.post('/api/auth/setup', async (req, reply) => {
      if (this.pinSet()) return reply.code(409).send({ error: 'A PIN is already set.' });
      const { pin } = PinBody.parse(req.body);
      setSetting(this.db, 'adminPin', hashPin(pin));
      this.startSession(reply);
      return { ok: true };
    });

    app.post('/api/auth/login', async (req, reply) => {
      const ip = req.ip;
      const fail = this.failures.get(ip);
      if (fail && fail.until > Date.now()) {
        return reply.code(429).send({ error: 'Too many attempts. Wait a bit and try again.' });
      }
      const { pin } = PinBody.parse(req.body);
      const stored = getSetting<PinHash>(this.db, 'adminPin');
      if (!stored || !checkPin(pin, stored)) {
        const count = (fail?.count ?? 0) + 1;
        this.failures.set(ip, { count, until: count >= 5 ? Date.now() + 30_000 * (count - 4) : 0 });
        return reply.code(401).send({ error: 'Wrong PIN.' });
      }
      this.failures.delete(ip);
      this.startSession(reply);
      return { ok: true };
    });

    app.post('/api/auth/logout', async (req, reply) => {
      const token = req.cookies[COOKIE];
      if (token) this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      reply.clearCookie(COOKIE, { path: '/' });
      return { ok: true };
    });

    app.post('/api/auth/pin', { preHandler: this.guard }, async (req) => {
      const { pin } = PinBody.parse(req.body);
      setSetting(this.db, 'adminPin', hashPin(pin));
      return { ok: true };
    });
  }
}
