import type { FastifyInstance } from 'fastify';
import { IngestPayload, IngestReminder, normalizeDue, type ReminderDTO } from '@hearthboard/shared';
import type { Auth } from './auth';
import type { TouchGate } from './boards';
import { getSetting, setSetting, type DB } from './db';
import type { LiveHub } from './live';
import { shortHash } from './util';

interface Row {
  id: string;
  title: string;
  list: string;
  due: string | null;
  notes: string | null;
  priority: number | null;
  flagged: number;
  completed: number;
  created: string | null;
  pending: number;
}

export interface IngestResult {
  received: number;
  skipped: number;
  /** Reminders ticked on the board that the Shortcut should now mark complete. */
  complete: { title: string; list: string; created: string | null }[];
}

export class Reminders {
  constructor(
    private db: DB,
    private live: LiveHub,
  ) {}

  list(lists?: string[]): ReminderDTO[] {
    const rows = this.db
      .prepare(
        `SELECT r.*, (a.reminder_id IS NOT NULL) AS pending FROM reminders r
         LEFT JOIN reminder_actions a ON a.reminder_id = r.id
         WHERE r.completed = 0 ORDER BY r.position`,
      )
      .all() as Row[];
    return rows
      .filter((r) => !lists?.length || lists.includes(r.list))
      .map((r) => ({
        id: r.id,
        title: r.title,
        list: r.list,
        due: r.due,
        notes: r.notes,
        priority: r.priority,
        flagged: !!r.flagged,
        completed: !!r.completed,
        pendingComplete: !!r.pending,
      }));
  }

  lists(): string[] {
    return (
      this.db.prepare('SELECT DISTINCT list FROM reminders ORDER BY list').all() as {
        list: string;
      }[]
    ).map((r) => r.list);
  }

  ingest(body: unknown): IngestResult {
    const payload = IngestPayload.parse(body);
    let skipped = 0;
    const items: (IngestReminder & { key: string })[] = [];
    for (const raw of payload.reminders) {
      const r = IngestReminder.safeParse(raw);
      if (!r.success) {
        skipped++;
        continue;
      }
      const list = r.data.list || 'Reminders';
      items.push({
        ...r.data,
        list,
        key: r.data.id || shortHash(list, r.data.title, r.data.created ?? ''),
      });
    }

    const tx = this.db.transaction(() => {
      if (payload.mode === 'replace') this.db.prepare('DELETE FROM reminders').run();
      const upsert = this.db.prepare(
        `INSERT INTO reminders (id, title, list, due, notes, priority, flagged, completed, created, position)
         VALUES (@id, @title, @list, @due, @notes, @priority, @flagged, @completed, @created, @position)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, list = excluded.list, due = excluded.due,
           notes = excluded.notes, priority = excluded.priority, flagged = excluded.flagged,
           completed = excluded.completed, created = excluded.created, position = excluded.position`,
      );
      items.forEach((r, i) =>
        upsert.run({
          id: r.key,
          title: r.title,
          list: r.list,
          due: normalizeDue(r.due),
          notes: r.notes || null,
          priority: r.priority ?? null,
          flagged: r.flagged ? 1 : 0,
          completed: r.completed ? 1 : 0,
          created: r.created || null,
          position: i,
        }),
      );
      // A board tick is done once the phone no longer reports that reminder as open.
      const open = new Set(items.filter((r) => !r.completed).map((r) => r.key));
      const actions = this.db.prepare('SELECT reminder_id FROM reminder_actions').all() as {
        reminder_id: string;
      }[];
      for (const a of actions) {
        if (!open.has(a.reminder_id))
          this.db.prepare('DELETE FROM reminder_actions WHERE reminder_id = ?').run(a.reminder_id);
      }
    });
    tx();
    setSetting(this.db, 'remindersLastIngest', Date.now());
    this.live.publish('reminders');

    const complete = this.db
      .prepare('SELECT title, list, created FROM reminder_actions ORDER BY requested_at')
      .all() as {
      title: string;
      list: string;
      created: string | null;
    }[];
    return { received: items.length, skipped, complete };
  }

  requestComplete(id: string, done: boolean): boolean {
    const r = this.db
      .prepare('SELECT id, title, list, created FROM reminders WHERE id = ?')
      .get(id) as Pick<Row, 'id' | 'title' | 'list' | 'created'> | undefined;
    if (!r) return false;
    if (done) {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO reminder_actions (reminder_id, title, list, created, action, requested_at)
           VALUES (?, ?, ?, ?, 'complete', ?)`,
        )
        .run(r.id, r.title, r.list, r.created, Date.now());
    } else {
      this.db.prepare('DELETE FROM reminder_actions WHERE reminder_id = ?').run(id);
    }
    this.live.publish('reminders');
    return true;
  }

  register(app: FastifyInstance, auth: Auth, touch: TouchGate = () => false) {
    // Header only: a token in the URL would be written to the request log.
    app.post('/api/reminders/ingest', async (req, reply) => {
      if (!auth.checkIngestToken(req.headers.authorization))
        return reply.code(401).send({ error: 'Bad or missing token' });
      return { ok: true, ...this.ingest(req.body) };
    });

    app.get<{ Querystring: { lists?: string } }>('/api/reminders', async (req) =>
      this.list(req.query.lists?.split(',').filter(Boolean)),
    );

    app.get('/api/reminders/lists', async () => this.lists());

    app.post<{ Params: { id: string }; Body: { done?: boolean } }>(
      '/api/reminders/:id/complete',
      {
        // A touch-screen board may tick reminders from the lists it shows.
        preHandler: auth.guardOr((req) => {
          const { id } = req.params as { id: string };
          const r = this.db.prepare('SELECT list FROM reminders WHERE id = ?').get(id) as
            { list: string } | undefined;
          return (
            !!r &&
            touch(req, (w) => {
              if (w.type !== 'reminders') return false;
              const lists = (w.config as { lists?: string[] }).lists ?? [];
              return !lists.length || lists.includes(r.list);
            })
          );
        }),
      },
      async (req, reply) => {
        const ok = this.requestComplete(req.params.id, req.body?.done !== false);
        return ok ? { ok } : reply.code(404).send({ error: 'No such reminder' });
      },
    );

    app.get('/api/reminders/setup', { preHandler: auth.adminGuard }, async () => ({
      token: auth.ingestToken(),
      lastIngest: getSetting<number>(this.db, 'remindersLastIngest') ?? null,
    }));

    app.post('/api/reminders/token', { preHandler: auth.adminGuard }, async () => ({
      token: auth.rotateIngestToken(),
    }));
  }
}
