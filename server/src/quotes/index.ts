import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { QuoteDTO } from '@hearthboard/shared';
import type { DB } from '../db';
import type { LiveHub } from '../live';
import type { Auth } from '../auth';
import type { DisplayGuard } from '../displays';
import verses from './data/verses-esv.json' with { type: 'json' };
import quotes from './data/quotes.json' with { type: 'json' };

const VERSES = (verses as [string, string][]).map(([text, source]) => ({
  text,
  source: `${source} (ESV)`,
}));
const QUOTES = (quotes as [string, string][]).map(([text, source]) => ({ text, source }));

export type QuoteMode = 'verse' | 'quote' | 'both' | 'custom';

/** Index of the current day (local time) or hour since the epoch. */
export function periodIndex(now: Date, rotate: 'daily' | 'hourly'): number {
  const localMidnightUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const day = Math.floor(localMidnightUtc / 86_400_000);
  return rotate === 'daily' ? day : day * 24 + now.getHours();
}

/** Stable pseudo-random pick so every display shows the same entry for the period. */
export function pick<T>(list: T[], period: number, salt: string): T {
  const h = crypto.createHash('sha1').update(`${salt}:${period}`).digest();
  return list[h.readUInt32BE(0) % list.length];
}

const CustomQuote = z.object({
  text: z.string().min(1).max(1000),
  source: z.string().max(200).default(''),
});

export class Quotes {
  constructor(
    private db: DB,
    private live: LiveHub,
  ) {}

  custom(): { id: string; text: string; source: string }[] {
    return this.db.prepare('SELECT id, text, source FROM quotes ORDER BY rowid').all() as {
      id: string;
      text: string;
      source: string;
    }[];
  }

  current(mode: QuoteMode, rotate: 'daily' | 'hourly', now = new Date()): QuoteDTO {
    const period = periodIndex(now, rotate);
    let kind: QuoteDTO['kind'] =
      mode === 'both'
        ? period % 2 === 0
          ? 'verse'
          : 'quote'
        : mode === 'custom'
          ? 'custom'
          : mode;
    if (kind === 'custom') {
      const list = this.custom();
      if (list.length) {
        const { text, source } = pick(list, period, 'custom');
        return { kind, text, source };
      }
      kind = 'verse';
    }
    return kind === 'verse'
      ? { kind, ...pick(VERSES, period, 'verse') }
      : { kind, ...pick(QUOTES, period, 'quote') };
  }

  register(app: FastifyInstance, auth: Auth, display: DisplayGuard) {
    app.get<{ Querystring: { mode?: QuoteMode; rotate?: 'daily' | 'hourly' } }>(
      '/api/quote',
      { preHandler: display },
      async (req) => {
        const mode = (['verse', 'quote', 'both', 'custom'] as const).includes(
          req.query.mode as QuoteMode,
        )
          ? (req.query.mode as QuoteMode)
          : 'verse';
        return this.current(mode, req.query.rotate === 'hourly' ? 'hourly' : 'daily');
      },
    );

    app.get('/api/quotes/custom', { preHandler: display }, async () => this.custom());

    app.post('/api/quotes/custom', { preHandler: auth.guard }, async (req) => {
      const q = CustomQuote.parse(req.body);
      const id = crypto.randomBytes(6).toString('hex');
      this.db
        .prepare('INSERT INTO quotes (id, text, source) VALUES (?, ?, ?)')
        .run(id, q.text, q.source);
      this.live.publish('quotes');
      return { id, ...q };
    });

    app.delete<{ Params: { id: string } }>(
      '/api/quotes/custom/:id',
      { preHandler: auth.guard },
      async (req) => {
        this.db.prepare('DELETE FROM quotes WHERE id = ?').run(req.params.id);
        this.live.publish('quotes');
        return { ok: true };
      },
    );
  }
}
