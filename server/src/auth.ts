import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CodeInput,
  LoginInput,
  PasswordChange,
  PasswordConfirm,
  SecurityPolicy,
  SetupInput,
  type AuthStatus,
} from '@hearthboard/shared';
import { getSetting, setSetting, type DB } from './db';
import type { UserRow, Users } from './users';
import { HttpError } from './util';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in user; set by `auth.guard`. */
    user: UserRow | null;
  }
}

const COOKIE = 'hb_session';
const SESSION_TTL_MS = 365 * 24 * 3600 * 1000;
/** How long a half-done sign-in (waiting for a code or authenticator setup) stays open. */
const PENDING_TTL_MS = 15 * 60_000;
/** Wrong codes allowed before the password has to be entered again. */
const MAX_CODE_ATTEMPTS = 5;
/** Wrong passwords or codes from one address are forgotten after this long without another. */
const FAILURE_MEMORY_MS = 3600_000;

type Stage = 'mfa' | 'enroll' | 'full';

interface SessionRow {
  token_hash: string;
  user_id: string;
  stage: Stage;
  attempts: number;
  created_at: number;
  last_seen: number;
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export interface AuthOptions {
  /** Password for an "admin" user created on first start (HEARTHBOARD_ADMIN_PASSWORD). */
  adminPassword: string | null;
  /** Reset "admin" to `adminPassword` with two-step sign-in off (HEARTHBOARD_RESET_ADMIN). */
  resetAdmin: boolean;
}

export class Auth {
  private failures = new Map<string, { count: number; until: number; last: number }>();

  constructor(
    private db: DB,
    private users: Users,
  ) {
    if (!getSetting<string>(db, 'ingestToken')) this.rotateIngestToken();
  }

  /** Apply the admin settings from the environment. Returns a warning to log, if any. */
  async init(opts: AuthOptions): Promise<string | null> {
    const { adminPassword, resetAdmin } = opts;
    if (resetAdmin) {
      if (!adminPassword)
        return 'HEARTHBOARD_RESET_ADMIN is set without HEARTHBOARD_ADMIN_PASSWORD; nothing was reset.';
      let admin = this.users.byUsername('admin');
      if (!admin) {
        admin = await this.users.create({
          username: 'admin',
          name: 'Admin',
          password: adminPassword,
          role: 'admin',
        });
      }
      await this.users.setPassword(admin.id, adminPassword);
      this.users.update(admin.id, { role: 'admin' });
      this.users.disableTotp(admin.id);
      this.endSessions(admin.id);
      this.users.adoptOrphanBoards(admin.id);
      return (
        'HEARTHBOARD_RESET_ADMIN: the "admin" user\'s password was reset and its two-step ' +
        'sign-in turned off. Remove HEARTHBOARD_RESET_ADMIN now so this is not repeated on every start.'
      );
    }
    if (adminPassword && this.users.count() === 0) {
      const admin = await this.users.create(
        { username: 'admin', name: 'Admin', password: adminPassword, role: 'admin' },
        { onlyIfFirst: true },
      );
      this.users.adoptOrphanBoards(admin.id);
    }
    return null;
  }

  requireMfa(): boolean {
    return getSetting<boolean>(this.db, 'requireMfa') ?? false;
  }

  // ---------------- reminders ingest token ----------------

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
    // Compare hashes: equal-length digests, however many bytes the given token has.
    const digest = (s: string) => crypto.createHash('sha256').update(s).digest();
    return crypto.timingSafeEqual(digest(given), digest(this.ingestToken()));
  }

  // ---------------- sessions ----------------

  private session(req: FastifyRequest): { s: SessionRow; user: UserRow } | null {
    const token = req.cookies[COOKIE];
    if (!token) return null;
    const s = this.db
      .prepare('SELECT * FROM sessions WHERE token_hash = ?')
      .get(hashToken(token)) as SessionRow | undefined;
    if (!s) return null;
    const now = Date.now();
    const expired =
      s.stage === 'full' ? now - s.last_seen > SESSION_TTL_MS : now - s.created_at > PENDING_TTL_MS;
    const user = expired ? undefined : this.users.get(s.user_id);
    if (!user) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(s.token_hash);
      return null;
    }
    if (s.stage === 'full' && now - s.last_seen > 3600_000) {
      this.db
        .prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?')
        .run(now, s.token_hash);
    }
    return { s, user };
  }

  /** The fully signed-in user, or null. */
  currentUser(req: FastifyRequest): UserRow | null {
    const cur = this.session(req);
    return cur?.s.stage === 'full' ? cur.user : null;
  }

  isAuthenticated(req: FastifyRequest): boolean {
    return !!this.currentUser(req);
  }

  isAdmin(req: FastifyRequest): boolean {
    return this.currentUser(req)?.role === 'admin';
  }

  /** preHandler for anything a signed-in household member may do. */
  guard = async (req: FastifyRequest, reply: FastifyReply) => {
    req.user = this.currentUser(req);
    if (!req.user) return reply.code(401).send({ error: 'Sign in first.' });
  };

  /**
   * preHandler: signed in, or `allow(req)` says the request may go ahead without signing in
   * (a tick from a touch-screen board).
   */
  guardOr(allow: (req: FastifyRequest) => boolean) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      req.user = this.currentUser(req);
      if (!req.user && !allow(req)) return reply.code(401).send({ error: 'Sign in first.' });
    };
  }

  /** preHandler for household settings: accounts, people, tokens. */
  adminGuard = async (req: FastifyRequest, reply: FastifyReply) => {
    req.user = this.currentUser(req);
    if (!req.user) return reply.code(401).send({ error: 'Sign in first.' });
    if (req.user.role !== 'admin')
      return reply.code(403).send({ error: 'Only an admin can do that.' });
  };

  private startSession(reply: FastifyReply, userId: string, stage: Stage) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    // Forget sessions nobody came back to.
    this.db
      .prepare(
        `DELETE FROM sessions WHERE (stage = 'full' AND last_seen < ?)
           OR (stage <> 'full' AND created_at < ?)`,
      )
      .run(now - SESSION_TTL_MS, now - PENDING_TTL_MS);
    this.db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, stage, created_at, last_seen) VALUES (?, ?, ?, ?, ?)',
      )
      .run(hashToken(token), userId, stage, now, now);
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: stage === 'full' ? SESSION_TTL_MS / 1000 : PENDING_TTL_MS / 1000,
    });
  }

  private endSession(req: FastifyRequest) {
    const token = req.cookies[COOKIE];
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  /** Sign a user out everywhere, except the session making this request. */
  endSessions(userId: string, keep?: FastifyRequest) {
    const token = keep?.cookies[COOKIE];
    this.db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
      .run(userId, token ? hashToken(token) : '');
  }

  // ---------------- brute-force protection ----------------

  /**
   * Wrong passwords count per address and account, so signing in to your own account doesn't
   * wipe out guesses at someone else's. Wrong codes count per account: whoever is guessing
   * them already has the password and can sign in again from anywhere.
   */
  private passwordKey(req: FastifyRequest, username: string) {
    return `${req.ip}|${username.trim().toLowerCase()}`;
  }

  private codeKey(userId: string) {
    return `code|${userId}`;
  }

  private checkThrottle(key: string) {
    const fail = this.failures.get(key);
    if (fail && fail.until > Date.now())
      throw new HttpError(429, 'Too many attempts. Wait a bit and try again.');
  }

  private recordFailure(key: string) {
    const now = Date.now();
    if (this.failures.size > 1000) {
      for (const [k, f] of this.failures) {
        if (now - f.last > FAILURE_MEMORY_MS && f.until < now) this.failures.delete(k);
      }
    }
    const prev = this.failures.get(key);
    const count = (prev && now - prev.last < FAILURE_MEMORY_MS ? prev.count : 0) + 1;
    this.failures.set(key, {
      count,
      until: count >= 5 ? now + 30_000 * (count - 4) : 0,
      last: now,
    });
  }

  /** Check the signed-in user's password again before a sensitive change, with the lockout. */
  private async confirmPassword(req: FastifyRequest, password: string, error: string) {
    const key = this.passwordKey(req, req.user!.username);
    this.checkThrottle(key);
    if (!(await this.users.checkPassword(req.user!, password))) {
      this.recordFailure(key);
      throw new HttpError(400, error);
    }
  }

  // ---------------- routes ----------------

  register(app: FastifyInstance) {
    app.decorateRequest('user', null);
    const signedIn = { preHandler: this.guard };

    app.get('/api/auth/status', async (req): Promise<AuthStatus> => {
      const cur = this.session(req);
      const full = cur?.s.stage === 'full';
      return {
        setupNeeded: this.users.count() === 0,
        authenticated: full,
        stage: cur && !full ? (cur.s.stage as 'mfa' | 'enroll') : null,
        user: full ? this.users.toDTO(cur.user) : null,
        requireMfa: this.requireMfa(),
        legacyPin: !!this.users.legacyPinUser(),
      };
    });

    // First run: create the first admin.
    app.post('/api/auth/setup', async (req, reply) => {
      const input = SetupInput.parse(req.body);
      const user = await this.users.create({ ...input, role: 'admin' }, { onlyIfFirst: true });
      this.users.adoptOrphanBoards(user.id);
      this.startSession(reply, user.id, 'full');
      return { stage: 'full' };
    });

    app.post('/api/auth/login', async (req, reply) => {
      const { username, password } = LoginInput.parse(req.body);
      const key = this.passwordKey(req, username);
      this.checkThrottle(key);
      const user = this.users.byUsername(username);
      if (!(await this.users.checkPassword(user, password))) {
        this.recordFailure(key);
        return reply.code(401).send({ error: 'Wrong username or password.' });
      }
      this.failures.delete(key);
      this.endSession(req);
      const stage: Stage = user!.totp_secret ? 'mfa' : this.requireMfa() ? 'enroll' : 'full';
      this.startSession(reply, user!.id, stage);
      return { stage };
    });

    // Second step: a code from the authenticator app, or a recovery code.
    app.post('/api/auth/mfa', async (req, reply) => {
      const cur = this.session(req);
      if (cur?.s.stage !== 'mfa')
        return reply.code(401).send({ error: 'That sign-in expired. Start again.' });
      const key = this.codeKey(cur.user.id);
      this.checkThrottle(key);
      const { code } = CodeInput.parse(req.body);
      const used = this.users.verifySecondFactor(cur.user.id, code);
      if (!used) {
        this.recordFailure(key);
        const attempts = cur.s.attempts + 1;
        if (attempts >= MAX_CODE_ATTEMPTS) {
          this.endSession(req);
          return reply.code(401).send({ error: 'Too many wrong codes. Start again.' });
        }
        this.db
          .prepare('UPDATE sessions SET attempts = ? WHERE token_hash = ?')
          .run(attempts, cur.s.token_hash);
        return reply.code(401).send({ error: 'That code is not right.' });
      }
      this.failures.delete(key);
      this.endSession(req);
      this.startSession(reply, cur.user.id, 'full');
      return {
        stage: 'full',
        usedRecoveryCode: used === 'recovery',
        recoveryCodesLeft: this.users.recoveryCodesLeft(cur.user.id),
      };
    });

    app.post('/api/auth/logout', async (req, reply) => {
      this.endSession(req);
      reply.clearCookie(COOKIE, { path: '/' });
      return { ok: true };
    });

    app.post('/api/auth/password', signedIn, async (req) => {
      const { current, password } = PasswordChange.parse(req.body);
      await this.confirmPassword(req, current, 'Your current password is not right.');
      await this.users.setPassword(req.user!.id, password);
      this.endSessions(req.user!.id, req);
      return { ok: true };
    });

    // Authenticator setup. Also reachable mid-sign-in when the household requires it.
    const enrolling = async (req: FastifyRequest, reply: FastifyReply) => {
      const cur = this.session(req);
      if (!cur || cur.s.stage === 'mfa') return reply.code(401).send({ error: 'Sign in first.' });
      req.user = cur.user;
    };

    app.post('/api/auth/totp/setup', { preHandler: enrolling }, async (req) => {
      if (req.user!.totp_secret)
        throw new HttpError(409, 'Two-step sign-in is already on. Turn it off first.');
      return this.users.startTotp(req.user!.id);
    });

    app.post('/api/auth/totp/enable', { preHandler: enrolling }, async (req, reply) => {
      if (req.user!.totp_secret) throw new HttpError(409, 'Two-step sign-in is already on.');
      const { code } = CodeInput.parse(req.body);
      const recoveryCodes = this.users.confirmTotp(req.user!.id, code);
      if (!recoveryCodes)
        throw new HttpError(400, 'That code is not right. Check the time on your phone.');
      // Other devices signed in without the second step: sign them out.
      this.endSessions(req.user!.id, req);
      if (this.session(req)?.s.stage === 'enroll') {
        this.endSession(req);
        this.startSession(reply, req.user!.id, 'full');
      }
      return { recoveryCodes };
    });

    app.post('/api/auth/totp/disable', signedIn, async (req) => {
      const { password } = PasswordConfirm.parse(req.body);
      await this.confirmPassword(req, password, 'Your password is not right.');
      this.users.disableTotp(req.user!.id);
      // Required for everyone: other devices sign in and set it up again (this one next time).
      if (this.requireMfa()) this.endSessions(req.user!.id, req);
      return { ok: true };
    });

    app.post('/api/auth/recovery-codes', signedIn, async (req) => {
      const { password } = PasswordConfirm.parse(req.body);
      if (!req.user!.totp_secret) throw new HttpError(400, 'Two-step sign-in is off.');
      await this.confirmPassword(req, password, 'Your password is not right.');
      return { recoveryCodes: this.users.newRecoveryCodes(req.user!.id) };
    });

    app.put('/api/auth/policy', { preHandler: this.adminGuard }, async (req) => {
      const { requireMfa } = SecurityPolicy.parse(req.body);
      if (requireMfa && !req.user!.totp_secret)
        throw new HttpError(400, 'Turn on two-step sign-in for your own account first.');
      setSetting(this.db, 'requireMfa', requireMfa);
      // Make it count now: whoever is signed in without it has to sign in (and set it up) again.
      if (requireMfa) {
        this.db
          .prepare(
            'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE totp_secret IS NULL)',
          )
          .run();
      }
      return { requireMfa };
    });
  }
}
