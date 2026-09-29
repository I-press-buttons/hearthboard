import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

/** Append-only list of migrations; index + 1 is the schema version. */
export const MIGRATIONS: (string | ((db: DB) => void))[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE sessions (token TEXT PRIMARY KEY, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
  CREATE TABLE boards (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);

  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    secret TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'ok',
    last_error TEXT,
    last_sync INTEGER
  );
  CREATE TABLE calendars (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    remote_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    writable INTEGER NOT NULL DEFAULT 1,
    cursor TEXT,
    UNIQUE (account_id, remote_id)
  );
  CREATE TABLE resources (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    remote_id TEXT NOT NULL,
    etag TEXT,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (calendar_id, remote_id)
  );

  CREATE TABLE reminders (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    list TEXT NOT NULL,
    due TEXT,
    notes TEXT,
    priority INTEGER,
    flagged INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    created TEXT,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE reminder_actions (
    reminder_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    list TEXT NOT NULL,
    created TEXT,
    action TEXT NOT NULL,
    requested_at INTEGER NOT NULL
  );

  CREATE TABLE checklists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    reset_daily INTEGER NOT NULL DEFAULT 0,
    last_reset TEXT
  );
  CREATE TABLE checklist_items (
    id TEXT PRIMARY KEY,
    checklist_id TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE quotes (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT ''
  );
  `,

  // Individual sign-ins (replacing the shared admin PIN), two-step sign-in and board owners.
  (db) => {
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        password TEXT NOT NULL,
        totp_secret TEXT,
        totp_pending TEXT,
        totp_last_step INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE recovery_codes (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        hash TEXT NOT NULL,
        PRIMARY KEY (user_id, hash)
      );
      DROP TABLE sessions;
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);
      ALTER TABLE boards ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;
    `);
    // An existing install becomes one admin user named "admin" whose password is the old PIN
    // (same scrypt format), owning every board.
    const pin = getSetting<unknown>(db, 'adminPin');
    if (pin) {
      const id = crypto.randomBytes(8).toString('hex');
      db.prepare(
        `INSERT INTO users (id, username, name, role, password, created_at)
         VALUES (?, 'admin', 'Admin', 'admin', ?, ?)`,
      ).run(id, JSON.stringify(pin), Date.now());
      db.prepare('UPDATE boards SET owner_id = ?').run(id);
      setSetting(db, 'legacyPinUser', id);
      db.prepare("DELETE FROM settings WHERE key = 'adminPin'").run();
    }
  },

  // Meal plan and family notes.
  `
  CREATE TABLE meals (
    date TEXT NOT NULL,
    slot TEXT NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (date, slot)
  );
  CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    color TEXT NOT NULL,
    author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
  );
  `,

  // Indexes for the lookups every display refresh and board list makes.
  `
  CREATE INDEX checklist_items_list ON checklist_items(checklist_id, position);
  CREATE INDEX boards_owner ON boards(owner_id);
  `,

  // Whether family members (not just admins) may add and change events on a calendar. Off for
  // every calendar, so connecting someone's personal or work account never opens it to the family.
  `
  ALTER TABLE calendars ADD COLUMN members_can_edit INTEGER NOT NULL DEFAULT 0;
  `,
];

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      const step = MIGRATIONS[v];
      if (typeof step === 'string') db.exec(step);
      else step(db);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export function getSetting<T>(db: DB, key: string): T | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function setSetting(db: DB, key: string, value: unknown) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}
