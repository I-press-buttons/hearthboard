import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { NoteInput, type NoteColor, type NoteDTO } from '@hearthboard/shared';
import type { Auth } from './auth';
import type { DB } from './db';
import type { LiveHub } from './live';
import { HttpError } from './util';

interface Row {
  id: string;
  text: string;
  color: NoteColor;
  author_id: string | null;
  author_name: string;
  created_at: number;
  expires_at: number | null;
}

const MAX_NOTES = 200;

/** Short notes for the family, posted from a phone and shown on the board until they expire. */
export class Notes {
  constructor(
    private db: DB,
    private live: LiveHub,
  ) {}

  list(now = Date.now()): NoteDTO[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM notes WHERE expires_at IS NULL OR expires_at > ?
         ORDER BY created_at DESC, rowid DESC`,
      )
      .all(now) as Row[];
    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      color: r.color,
      author: r.author_name,
      authorId: r.author_id,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    }));
  }

  create(author: { id: string | null; name: string }, input: NoteInput, now = Date.now()): NoteDTO {
    const id = crypto.randomBytes(6).toString('hex');
    const expiresAt =
      input.expiresInHours === null ? null : now + Math.round(input.expiresInHours * 3600_000);
    this.db
      .prepare(
        `INSERT INTO notes (id, text, color, author_id, author_name, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.text, input.color, author.id, author.name, now, expiresAt);
    // Keep the table small: forget the oldest notes past the cap.
    this.db
      .prepare(
        `DELETE FROM notes WHERE id NOT IN (SELECT id FROM notes ORDER BY created_at DESC LIMIT ?)`,
      )
      .run(MAX_NOTES);
    this.live.publish('notes');
    return this.list(now).find((n) => n.id === id)!;
  }

  /** Remove expired notes. Returns true if any were removed. */
  purgeExpired(now = Date.now()): boolean {
    return (
      this.db.prepare('DELETE FROM notes WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now)
        .changes > 0
    );
  }

  /** Once a minute, take expired notes off open screens. */
  startExpiry(): () => void {
    const t = setInterval(() => {
      if (this.purgeExpired()) this.live.publish('notes');
    }, 60_000);
    return () => clearInterval(t);
  }

  register(app: FastifyInstance, auth: Auth) {
    // Public, like the rest of the display.
    app.get('/api/notes', async () => this.list());

    app.post('/api/notes', { preHandler: auth.guard }, async (req) =>
      this.create(req.user!, NoteInput.parse(req.body)),
    );

    // Whoever posted a note, or an admin, can take it down.
    app.delete<{ Params: { id: string } }>(
      '/api/notes/:id',
      { preHandler: auth.guard },
      async (req) => {
        const row = this.db
          .prepare('SELECT author_id, author_name FROM notes WHERE id = ?')
          .get(req.params.id) as Pick<Row, 'author_id' | 'author_name'> | undefined;
        if (!row) throw new HttpError(404, 'That note is already gone.');
        if (req.user!.role !== 'admin' && row.author_id !== req.user!.id)
          throw new HttpError(403, `Only ${row.author_name} or an admin can take this note down.`);
        this.db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
        this.live.publish('notes');
        return { ok: true };
      },
    );
  }
}
