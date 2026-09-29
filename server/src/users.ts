import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import {
  NewUserInput,
  UserPatch,
  type Role,
  type TotpSetup,
  type UserDTO,
} from '@hearthboard/shared';
import type { Auth } from './auth';
import { getSetting, type DB } from './db';
import type { SecretBox } from './secrets';
import { generateSecret, otpauthUri, verifyTotp } from './totp';
import { HttpError } from './util';

const scrypt = promisify(crypto.scrypt) as (
  pw: string,
  salt: string,
  len: number,
) => Promise<Buffer>;

interface PasswordHash {
  salt: string;
  hash: string;
}

export interface UserRow {
  id: string;
  username: string;
  name: string;
  role: Role;
  password: string;
  totp_secret: string | null;
  totp_pending: string | null;
  totp_last_step: number;
  created_at: number;
}

const RECOVERY_CODES = 10;
// No 0/o, 1/l/i: easy to read back off paper.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Same scrypt format the old admin PIN used, so a migrated PIN still works as a password. */
async function hashPassword(
  password: string,
  salt = crypto.randomBytes(16).toString('base64url'),
): Promise<PasswordHash> {
  return { salt, hash: (await scrypt(password, salt, 32)).toString('base64url') };
}

function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

function newRecoveryCode(): string {
  const bytes = crypto.randomBytes(10);
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export class Users {
  // Checked when a username doesn't exist, so a miss takes as long as a wrong password.
  private dummy = hashPassword('not a real password');

  constructor(
    private db: DB,
    private secrets: SecretBox,
  ) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  adminCount(): number {
    return (
      this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as {
        n: number;
      }
    ).n;
  }

  get(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  byUsername(username: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as
      UserRow | undefined;
  }

  toDTO(u: UserRow): UserDTO {
    return {
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      mfa: !!u.totp_secret,
      recoveryCodesLeft: u.totp_secret ? this.recoveryCodesLeft(u.id) : 0,
      createdAt: u.created_at,
    };
  }

  list(): UserDTO[] {
    return (
      this.db.prepare('SELECT * FROM users ORDER BY created_at, rowid').all() as UserRow[]
    ).map((u) => this.toDTO(u));
  }

  /**
   * Add a user. With `onlyIfFirst`, refuse (409) unless nobody exists yet: the check and insert
   * happen together, after the slow password hash, so two first-run setups can't both win.
   */
  async create(
    input: { username: string; name: string; password: string; role: Role },
    opts: { onlyIfFirst?: boolean } = {},
  ): Promise<UserRow> {
    const hash = await hashPassword(input.password);
    const id = crypto.randomBytes(8).toString('hex');
    this.db.transaction(() => {
      if (opts.onlyIfFirst && this.count() > 0) throw new HttpError(409, 'Already set up.');
      if (this.byUsername(input.username)) throw new HttpError(409, 'That username is taken.');
      this.db
        .prepare(
          `INSERT INTO users (id, username, name, role, password, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.username, input.name, input.role, JSON.stringify(hash), Date.now());
    })();
    return this.get(id)!;
  }

  update(id: string, patch: { username?: string; name?: string; role?: Role }) {
    const u = this.get(id);
    if (!u) throw new HttpError(404, 'No such user');
    if (patch.username && patch.username !== u.username) {
      const other = this.byUsername(patch.username);
      if (other && other.id !== id) throw new HttpError(409, 'That username is taken.');
    }
    if (patch.role === 'member' && u.role === 'admin' && this.adminCount() <= 1)
      throw new HttpError(400, 'There must be at least one admin.');
    this.db
      .prepare('UPDATE users SET username = ?, name = ?, role = ? WHERE id = ?')
      .run(patch.username ?? u.username, patch.name ?? u.name, patch.role ?? u.role, id);
    if (patch.username && this.legacyPinUser() === id) this.clearLegacyPin();
  }

  delete(id: string) {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (this.legacyPinUser() === id) this.clearLegacyPin();
  }

  async checkPassword(u: UserRow | undefined, password: string): Promise<boolean> {
    const stored: PasswordHash = u ? JSON.parse(u.password) : await this.dummy;
    const { hash } = await hashPassword(password, stored.salt);
    const ok = crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(stored.hash));
    return ok && !!u;
  }

  async setPassword(id: string, password: string) {
    const hash = await hashPassword(password);
    this.db.prepare('UPDATE users SET password = ? WHERE id = ?').run(JSON.stringify(hash), id);
    if (this.legacyPinUser() === id) this.clearLegacyPin();
  }

  /** Give boards without an owner (a fresh install's first board) to this user. */
  adoptOrphanBoards(id: string) {
    this.db.prepare('UPDATE boards SET owner_id = ? WHERE owner_id IS NULL').run(id);
  }

  legacyPinUser(): string | null {
    return getSetting<string>(this.db, 'legacyPinUser') ?? null;
  }

  private clearLegacyPin() {
    this.db.prepare("DELETE FROM settings WHERE key = 'legacyPinUser'").run();
  }

  // ---------------- two-step sign-in ----------------

  /** Make a new authenticator secret; it only takes effect once confirmed with a code. */
  async startTotp(id: string): Promise<TotpSetup> {
    const u = this.get(id)!;
    const secret = generateSecret();
    this.db
      .prepare('UPDATE users SET totp_pending = ? WHERE id = ?')
      .run(this.secrets.seal(secret), id);
    const uri = otpauthUri(secret, u.username);
    const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { secret, uri, qrSvg };
  }

  /** Turn on two-step sign-in if `code` matches the pending secret. Returns recovery codes. */
  confirmTotp(id: string, code: string): string[] | null {
    const u = this.get(id);
    if (!u?.totp_pending) throw new HttpError(400, 'Start the setup again.');
    const secret = this.secrets.open<string>(u.totp_pending);
    const step = verifyTotp(secret, code);
    if (step === null) return null;
    this.db
      .prepare(
        'UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_last_step = ? WHERE id = ?',
      )
      .run(u.totp_pending, step, id);
    return this.newRecoveryCodes(id);
  }

  /**
   * Check a sign-in code: a 6-digit authenticator code (each usable once) or a recovery code
   * (each usable once, then gone).
   */
  verifySecondFactor(id: string, code: string): 'totp' | 'recovery' | null {
    const u = this.get(id);
    if (!u?.totp_secret) return null;
    if (/^\d{6}$/.test(code.replace(/\s/g, ''))) {
      const secret = this.secrets.open<string>(u.totp_secret);
      const step = verifyTotp(secret, code, u.totp_last_step);
      if (step === null) return null;
      this.db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, id);
      return 'totp';
    }
    const used = this.db
      .prepare('DELETE FROM recovery_codes WHERE user_id = ? AND hash = ?')
      .run(id, hashRecoveryCode(code));
    return used.changes ? 'recovery' : null;
  }

  disableTotp(id: string) {
    this.db
      .prepare(
        'UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_last_step = 0 WHERE id = ?',
      )
      .run(id);
    this.db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(id);
  }

  newRecoveryCodes(id: string): string[] {
    const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(id);
      const insert = this.db.prepare('INSERT INTO recovery_codes (user_id, hash) VALUES (?, ?)');
      for (const c of codes) insert.run(id, hashRecoveryCode(c));
    })();
    return codes;
  }

  recoveryCodesLeft(id: string): number {
    return (
      this.db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ?').get(id) as {
        n: number;
      }
    ).n;
  }

  // ---------------- admin routes ----------------

  register(
    app: FastifyInstance,
    auth: Auth,
    hooks: {
      /** Give a new user a board of their own. */
      createStarterBoard: (userId: string, name: string) => void;
      /** Hand a removed user's boards to someone else. */
      transferBoards: (fromId: string, toId: string) => void;
    },
  ) {
    const admin = { preHandler: auth.adminGuard };

    app.get('/api/users', admin, async () => this.list());

    app.post('/api/users', admin, async (req) => {
      const input = NewUserInput.parse(req.body);
      const u = await this.create(input);
      hooks.createStarterBoard(u.id, u.name);
      return this.toDTO(u);
    });

    app.patch<{ Params: { id: string } }>('/api/users/:id', admin, async (req) => {
      const patch = UserPatch.parse(req.body);
      const target = this.get(req.params.id);
      if (!target) throw new HttpError(404, 'No such user');
      this.update(target.id, patch);
      if (patch.password) await this.setPassword(target.id, patch.password);
      if (patch.resetMfa) this.disableTotp(target.id);
      // New password or no more authenticator: sign them out everywhere (but not you, here).
      if (patch.password || patch.resetMfa) auth.endSessions(target.id, req);
      return this.toDTO(this.get(target.id)!);
    });

    app.delete<{ Params: { id: string } }>('/api/users/:id', admin, async (req) => {
      const me = req.user!;
      if (req.params.id === me.id) throw new HttpError(400, "You can't remove yourself.");
      if (!this.get(req.params.id)) throw new HttpError(404, 'No such user');
      this.db.transaction(() => {
        hooks.transferBoards(req.params.id, me.id);
        this.delete(req.params.id);
      })();
      return { ok: true };
    });
  }
}
