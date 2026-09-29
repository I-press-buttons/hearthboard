import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MealDate, MealInput, MealSlotParam, type MealDTO } from '@hearthboard/shared';
import type { Auth } from './auth';
import type { DB } from './db';
import type { LiveHub } from './live';
import { localDate } from './util';

/** YYYY-MM-DD plus `n` days. */
export function addDaysYmd(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The household's meal plan: one line of text per day and meal. */
export class Meals {
  constructor(
    private db: DB,
    private live: LiveHub,
  ) {}

  range(start: string, days: number): MealDTO[] {
    return this.db
      .prepare(
        `SELECT date, slot, text FROM meals WHERE date >= ? AND date < ?
         ORDER BY date, CASE slot WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END`,
      )
      .all(start, addDaysYmd(start, days)) as MealDTO[];
  }

  set(date: string, slot: MealDTO['slot'], text: string): MealDTO {
    if (text) {
      this.db
        .prepare(
          `INSERT INTO meals (date, slot, text) VALUES (?, ?, ?)
           ON CONFLICT(date, slot) DO UPDATE SET text = excluded.text`,
        )
        .run(date, slot, text);
    } else {
      this.db.prepare('DELETE FROM meals WHERE date = ? AND slot = ?').run(date, slot);
    }
    this.live.publish('meals');
    return { date, slot, text };
  }

  register(app: FastifyInstance, auth: Auth) {
    // Public, like the rest of the display.
    app.get('/api/meals', async (req) => {
      const q = z
        .object({
          start: MealDate.optional(),
          days: z.coerce.number().int().min(1).max(62).default(7),
        })
        .parse(req.query);
      return this.range(q.start ?? localDate(new Date()), q.days);
    });

    app.put<{ Params: { date: string; slot: string } }>(
      '/api/meals/:date/:slot',
      { preHandler: auth.guard },
      async (req) => {
        const date = MealDate.parse(req.params.date);
        const slot = MealSlotParam.parse(req.params.slot);
        const { text } = MealInput.parse(req.body);
        return this.set(date, slot, text);
      },
    );
  }
}
