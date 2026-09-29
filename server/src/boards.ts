import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  Board,
  boardFromExport,
  type BoardSummary,
  type WidgetInstance,
} from '@hearthboard/shared';
import type { DB } from './db';
import type { LiveHub } from './live';
import type { Auth } from './auth';
import type { DisplayGuard } from './displays';
import type { UserRow } from './users';
import { HttpError } from './util';

const newBoardId = () => crypto.randomBytes(4).toString('hex');
const newWidgetId = () => crypto.randomBytes(6).toString('hex');

const NewBoardInput = z.object({
  name: z.string().max(100).optional(),
  copyFrom: z.string().max(64).optional(),
  layout: z.unknown().optional(),
});

/** Header a display sends to say which board it's showing (for touch-screen mode). */
export const BOARD_HEADER = 'x-hearthboard-board';

/**
 * Whether a request may skip signing in because it comes from a touch-screen board showing a
 * widget that `match` accepts.
 */
export type TouchGate = (req: FastifyRequest, match: (w: WidgetInstance) => boolean) => boolean;

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

  /** Everyone's boards for an admin, otherwise just the user's own. */
  list(user: UserRow): BoardSummary[] {
    const rows = this.db
      .prepare(
        `SELECT b.data, b.owner_id, u.name AS owner_name FROM boards b
         LEFT JOIN users u ON u.id = b.owner_id
         WHERE ? = 'admin' OR b.owner_id = ? ORDER BY b.rowid`,
      )
      .all(user.role, user.id) as {
      data: string;
      owner_id: string | null;
      owner_name: string | null;
    }[];
    return rows.map((r) => {
      const b = JSON.parse(r.data) as Board;
      return { id: b.id, name: b.name, ownerId: r.owner_id, ownerName: r.owner_name };
    });
  }

  get(id: string): Board | null {
    const row = this.db.prepare('SELECT data FROM boards WHERE id = ?').get(id) as
      { data: string } | undefined;
    return row ? Board.parse(JSON.parse(row.data)) : null;
  }

  private owner(id: string): { owner_id: string | null } | undefined {
    return this.db.prepare('SELECT owner_id FROM boards WHERE id = ?').get(id) as
      { owner_id: string | null } | undefined;
  }

  /** 404 if the board doesn't exist, 403 unless it's the user's own or they're an admin. */
  private checkAccess(user: UserRow, id: string) {
    const row = this.owner(id);
    if (!row) throw new HttpError(404, 'No such board');
    if (user.role !== 'admin' && row.owner_id !== user.id)
      throw new HttpError(403, "That's someone else's board.");
    return row;
  }

  save(board: Board): Board {
    const parsed = Board.parse(board);
    this.db
      .prepare('UPDATE boards SET data = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(parsed), Date.now(), parsed.id);
    this.live.publish('board', parsed.id);
    return parsed;
  }

  create(ownerId: string | null, board: Board): Board {
    const parsed = Board.parse(board);
    this.db
      .prepare('INSERT INTO boards (id, data, updated_at, owner_id) VALUES (?, ?, ?, ?)')
      .run(parsed.id, JSON.stringify(parsed), Date.now(), ownerId);
    this.live.publish('board', parsed.id);
    return parsed;
  }

  /** A new user's first board, with the usual widgets. */
  createStarter(ownerId: string, name: string, checklistId: string): Board {
    return this.create(
      ownerId,
      Board.parse({ id: newBoardId(), name, widgets: defaultWidgets(checklistId) }),
    );
  }

  transfer(fromId: string, toId: string) {
    this.db.prepare('UPDATE boards SET owner_id = ? WHERE owner_id = ?').run(toId, fromId);
    this.live.publish('board');
  }

  /** See TouchGate. */
  touchGate: TouchGate = (req, match) => {
    const id = req.headers[BOARD_HEADER];
    if (typeof id !== 'string' || !id) return false;
    const board = this.get(id);
    return !!board?.interactive && board.widgets.some(match);
  };

  /** Create the first board on a fresh install. */
  ensureDefault(checklistId: string) {
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM boards').get() as { n: number }).n;
    if (count === 0) {
      const admin = this.db
        .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, rowid LIMIT 1")
        .get() as { id: string } | undefined;
      this.create(
        admin?.id ?? null,
        Board.parse({ id: 'main', name: 'Home', widgets: defaultWidgets(checklistId) }),
      );
    }
  }

  register(app: FastifyInstance, auth: Auth, display: DisplayGuard) {
    const signedIn = { preHandler: auth.guard };

    app.get('/api/boards', signedIn, async (req) => this.list(req.user!));

    // For anyone signed in and for paired screens: TVs show a board without signing in.
    app.get<{ Params: { id: string } }>(
      '/api/boards/:id',
      { preHandler: display },
      async (req, reply) => {
        const board = this.get(req.params.id);
        return board ?? reply.code(404).send({ error: 'No such board' });
      },
    );

    app.put<{ Params: { id: string } }>('/api/boards/:id', signedIn, async (req) => {
      this.checkAccess(req.user!, req.params.id);
      const board = Board.parse({ ...(req.body as object), id: req.params.id });
      return this.save(board);
    });

    app.post('/api/boards', signedIn, async (req) => {
      const body = NewBoardInput.parse(req.body ?? {});
      // Import an exported layout (see "Export layout" in Board settings).
      if (body.layout !== undefined) {
        let board: Board;
        try {
          board = boardFromExport(body.layout, newBoardId(), newWidgetId);
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        if (body.name) board.name = body.name.slice(0, 100);
        return this.create(req.user!.id, board);
      }
      const base = body.copyFrom ? this.get(body.copyFrom) : null;
      return this.create(
        req.user!.id,
        Board.parse({
          ...(base ?? {}),
          id: newBoardId(),
          name: body.name || 'New board',
          widgets: base?.widgets ?? [],
        }),
      );
    });

    // Admins can hand a board to someone else, e.g. set one up for a child.
    app.put<{ Params: { id: string } }>(
      '/api/boards/:id/owner',
      { preHandler: auth.adminGuard },
      async (req) => {
        const { ownerId } = z.object({ ownerId: z.string().min(1) }).parse(req.body);
        this.checkAccess(req.user!, req.params.id);
        if (!this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(ownerId))
          throw new HttpError(400, 'No such user');
        this.db.prepare('UPDATE boards SET owner_id = ? WHERE id = ?').run(ownerId, req.params.id);
        this.live.publish('board', req.params.id);
        return { ok: true };
      },
    );

    app.delete<{ Params: { id: string } }>('/api/boards/:id', signedIn, async (req) => {
      const { owner_id } = this.checkAccess(req.user!, req.params.id);
      const left = (
        this.db.prepare('SELECT COUNT(*) AS n FROM boards WHERE owner_id IS ?').get(owner_id) as {
          n: number;
        }
      ).n;
      if (left <= 1) throw new HttpError(400, 'Keep at least one board.');
      this.db.prepare('DELETE FROM boards WHERE id = ?').run(req.params.id);
      this.live.publish('board', req.params.id);
      return { ok: true };
    });
  }
}
