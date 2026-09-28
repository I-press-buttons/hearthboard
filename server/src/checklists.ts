import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  ChecklistInput,
  ChecklistItemInput,
  ChecklistItemPatch,
  type ChecklistDTO,
} from '@hearthboard/shared';
import type { DB } from './db';
import type { LiveHub } from './live';
import type { Auth } from './auth';
import { localDate } from './util';

interface ListRow {
  id: string;
  name: string;
  reset_daily: number;
  last_reset: string | null;
}
interface ItemRow {
  id: string;
  text: string;
  done: number;
  position: number;
}

const newId = () => crypto.randomBytes(6).toString('hex');

export class Checklists {
  constructor(
    private db: DB,
    private live: LiveHub,
  ) {}

  /** Untick every item of "reset daily" lists once per local day. Returns true if anything changed. */
  resetIfNewDay(now = new Date()): boolean {
    const today = localDate(now);
    const stale = this.db
      .prepare(
        'SELECT id FROM checklists WHERE reset_daily = 1 AND (last_reset IS NULL OR last_reset <> ?)',
      )
      .all(today) as { id: string }[];
    if (!stale.length) return false;
    const tx = this.db.transaction(() => {
      for (const { id } of stale) {
        this.db.prepare('UPDATE checklist_items SET done = 0 WHERE checklist_id = ?').run(id);
        this.db.prepare('UPDATE checklists SET last_reset = ? WHERE id = ?').run(today, id);
      }
    });
    tx();
    return true;
  }

  all(): ChecklistDTO[] {
    this.resetIfNewDay();
    const lists = this.db.prepare('SELECT * FROM checklists ORDER BY rowid').all() as ListRow[];
    return lists.map((l) => this.toDTO(l));
  }

  get(id: string): ChecklistDTO | null {
    this.resetIfNewDay();
    const l = this.db.prepare('SELECT * FROM checklists WHERE id = ?').get(id) as
      ListRow | undefined;
    return l ? this.toDTO(l) : null;
  }

  private toDTO(l: ListRow): ChecklistDTO {
    const items = this.db
      .prepare('SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY position, rowid')
      .all(l.id) as ItemRow[];
    return {
      id: l.id,
      name: l.name,
      resetDaily: !!l.reset_daily,
      items: items.map((i) => ({ id: i.id, text: i.text, done: !!i.done, position: i.position })),
    };
  }

  create(name: string, resetDaily = false, items: string[] = []): ChecklistDTO {
    const id = newId();
    this.db
      .prepare('INSERT INTO checklists (id, name, reset_daily, last_reset) VALUES (?, ?, ?, ?)')
      .run(id, name, resetDaily ? 1 : 0, localDate(new Date()));
    items.forEach((text) => this.addItem(id, text));
    this.live.publish('checklists', id);
    return this.get(id)!;
  }

  addItem(checklistId: string, text: string) {
    const max = this.db
      .prepare(
        'SELECT COALESCE(MAX(position), -1) AS m FROM checklist_items WHERE checklist_id = ?',
      )
      .get(checklistId) as { m: number };
    const id = newId();
    this.db
      .prepare('INSERT INTO checklist_items (id, checklist_id, text, position) VALUES (?, ?, ?, ?)')
      .run(id, checklistId, text, max.m + 1);
    this.live.publish('checklists', checklistId);
    return id;
  }

  /** Create a starter list on a fresh install; returns its id. */
  ensureDefault(): string {
    const first = this.db.prepare('SELECT id FROM checklists ORDER BY rowid LIMIT 1').get() as
      { id: string } | undefined;
    if (first) return first.id;
    return this.create('Today', true, ['Make beds', 'Feed the dog', 'Pack lunches']).id;
  }

  /** Midnight tick so displays drop yesterday's ticks without a page reload. */
  startDailyReset(): () => void {
    const t = setInterval(() => {
      if (this.resetIfNewDay()) this.live.publish('checklists');
    }, 60_000);
    return () => clearInterval(t);
  }

  register(app: FastifyInstance, auth: Auth) {
    const guard = { preHandler: auth.guard };

    app.get('/api/checklists', async () => this.all());

    app.get<{ Params: { id: string } }>('/api/checklists/:id', async (req, reply) => {
      return this.get(req.params.id) ?? reply.code(404).send({ error: 'No such checklist' });
    });

    app.post('/api/checklists', guard, async (req) => {
      const body = ChecklistInput.parse(req.body);
      return this.create(body.name, body.resetDaily);
    });

    app.patch<{ Params: { id: string } }>('/api/checklists/:id', guard, async (req, reply) => {
      const body = ChecklistInput.partial().parse(req.body);
      const cur = this.get(req.params.id);
      if (!cur) return reply.code(404).send({ error: 'No such checklist' });
      this.db
        .prepare('UPDATE checklists SET name = ?, reset_daily = ? WHERE id = ?')
        .run(body.name ?? cur.name, (body.resetDaily ?? cur.resetDaily) ? 1 : 0, cur.id);
      this.live.publish('checklists', cur.id);
      return this.get(cur.id);
    });

    app.delete<{ Params: { id: string } }>('/api/checklists/:id', guard, async (req) => {
      this.db.prepare('DELETE FROM checklists WHERE id = ?').run(req.params.id);
      this.live.publish('checklists', req.params.id);
      return { ok: true };
    });

    app.post<{ Params: { id: string } }>('/api/checklists/:id/items', guard, async (req, reply) => {
      const { text } = ChecklistItemInput.parse(req.body);
      if (!this.get(req.params.id)) return reply.code(404).send({ error: 'No such checklist' });
      this.addItem(req.params.id, text);
      return this.get(req.params.id);
    });

    app.patch<{ Params: { id: string; itemId: string } }>(
      '/api/checklists/:id/items/:itemId',
      guard,
      async (req) => {
        const patch = ChecklistItemPatch.parse(req.body);
        const sets: string[] = [];
        const args: unknown[] = [];
        const set = (col: string, value: unknown) => {
          sets.push(`${col} = ?`);
          args.push(value);
        };
        if (patch.text !== undefined) set('text', patch.text);
        if (patch.done !== undefined) set('done', patch.done ? 1 : 0);
        if (patch.position !== undefined) set('position', patch.position);
        if (sets.length) {
          this.db
            .prepare(
              `UPDATE checklist_items SET ${sets.join(', ')} WHERE id = ? AND checklist_id = ?`,
            )
            .run(...args, req.params.itemId, req.params.id);
          this.live.publish('checklists', req.params.id);
        }
        return this.get(req.params.id);
      },
    );

    app.delete<{ Params: { id: string; itemId: string } }>(
      '/api/checklists/:id/items/:itemId',
      guard,
      async (req) => {
        this.db
          .prepare('DELETE FROM checklist_items WHERE id = ? AND checklist_id = ?')
          .run(req.params.itemId, req.params.id);
        this.live.publish('checklists', req.params.id);
        return this.get(req.params.id);
      },
    );

    app.post<{ Params: { id: string } }>('/api/checklists/:id/clear-done', guard, async (req) => {
      this.db
        .prepare('DELETE FROM checklist_items WHERE checklist_id = ? AND done = 1')
        .run(req.params.id);
      this.live.publish('checklists', req.params.id);
      return this.get(req.params.id);
    });
  }
}
