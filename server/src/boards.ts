import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Board, type WidgetInstance } from '@hearthboard/shared';
import type { DB } from './db';
import type { LiveHub } from './live';
import type { Auth } from './auth';

export function defaultWidgets(checklistId: string): WidgetInstance[] {
  const id = () => crypto.randomBytes(6).toString('hex');
  return [
    { id: id(), type: 'clock', x: 0, y: 0, w: 6, h: 3, config: {} },
    { id: id(), type: 'quote', x: 0, y: 3, w: 6, h: 4, config: {} },
    { id: id(), type: 'photo', x: 0, y: 7, w: 6, h: 9, config: {} },
    { id: id(), type: 'calendar', x: 6, y: 0, w: 12, h: 16, config: {} },
    { id: id(), type: 'reminders', x: 18, y: 0, w: 6, h: 8, config: {} },
    { id: id(), type: 'checklist', x: 18, y: 8, w: 6, h: 8, config: { checklistId } },
  ];
}

export class Boards {
  constructor(
    private db: DB,
    private live: LiveHub,
  ) {}

  list(): { id: string; name: string }[] {
    return (
      this.db.prepare('SELECT data FROM boards ORDER BY rowid').all() as { data: string }[]
    ).map((r) => {
      const b = JSON.parse(r.data) as Board;
      return { id: b.id, name: b.name };
    });
  }

  get(id: string): Board | null {
    const row = this.db.prepare('SELECT data FROM boards WHERE id = ?').get(id) as
      { data: string } | undefined;
    return row ? Board.parse(JSON.parse(row.data)) : null;
  }

  save(board: Board): Board {
    const parsed = Board.parse(board);
    this.db
      .prepare(
        `INSERT INTO boards (id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(parsed.id, JSON.stringify(parsed), Date.now());
    this.live.publish('board', parsed.id);
    return parsed;
  }

  /** Create the first board on a fresh install. */
  ensureDefault(checklistId: string) {
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM boards').get() as { n: number }).n;
    if (count === 0) {
      this.save(Board.parse({ id: 'main', name: 'Home', widgets: defaultWidgets(checklistId) }));
    }
  }

  register(app: FastifyInstance, auth: Auth) {
    app.get('/api/boards', async () => this.list());

    app.get<{ Params: { id: string } }>('/api/boards/:id', async (req, reply) => {
      const board = this.get(req.params.id);
      return board ?? reply.code(404).send({ error: 'No such board' });
    });

    app.put<{ Params: { id: string } }>(
      '/api/boards/:id',
      { preHandler: auth.guard },
      async (req) => {
        const board = Board.parse({ ...(req.body as object), id: req.params.id });
        return this.save(board);
      },
    );

    app.post('/api/boards', { preHandler: auth.guard }, async (req) => {
      const body = (req.body ?? {}) as { name?: string; copyFrom?: string };
      const base = body.copyFrom ? this.get(body.copyFrom) : null;
      const id = crypto.randomBytes(4).toString('hex');
      return this.save(
        Board.parse({
          ...(base ?? {}),
          id,
          name: body.name || 'New board',
          widgets: base?.widgets ?? [],
        }),
      );
    });

    app.delete<{ Params: { id: string } }>(
      '/api/boards/:id',
      { preHandler: auth.guard },
      async (req, reply) => {
        if (this.list().length <= 1)
          return reply.code(400).send({ error: 'Keep at least one board.' });
        this.db.prepare('DELETE FROM boards WHERE id = ?').run(req.params.id);
        this.live.publish('board', req.params.id);
        return { ok: true };
      },
    );
  }
}
