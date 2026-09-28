import { z } from 'zod';

export interface ReminderDTO {
  id: string;
  title: string;
  list: string;
  /** ISO date-time or YYYY-MM-DD, when known. */
  due: string | null;
  notes: string | null;
  priority: number | null;
  flagged: boolean;
  completed: boolean;
  /** True while a tick made on the board waits for the iPhone Shortcut to apply it. */
  pendingComplete: boolean;
}

/** iOS Shortcuts sends booleans as true/false, 1/0 or "Yes"/"No" depending on how the dictionary was built. */
const LooseBool = z.preprocess((v) => {
  if (typeof v === 'string') return ['yes', 'true', '1'].includes(v.trim().toLowerCase());
  if (typeof v === 'number') return v !== 0;
  return v;
}, z.boolean());

const LooseString = z.preprocess(
  (v) => (v === null || v === undefined ? undefined : typeof v === 'string' ? v.trim() : String(v)),
  z.string().optional(),
);

const LooseNumber = z.preprocess((v) => {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}, z.number().optional());

export const IngestReminder = z.object({
  id: LooseString,
  title: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).max(1000)),
  list: LooseString,
  due: LooseString,
  notes: LooseString,
  priority: LooseNumber,
  flagged: LooseBool.optional(),
  completed: LooseBool.optional(),
  created: LooseString,
});
export type IngestReminder = z.infer<typeof IngestReminder>;

export const IngestPayload = z.preprocess(
  (v) => (Array.isArray(v) ? { reminders: v } : v),
  z.object({
    reminders: z.array(z.unknown()).max(5000),
    /** `replace` (default) treats the payload as the full set of open reminders. */
    mode: z.enum(['replace', 'merge']).default('replace'),
  }),
);

/** Lenient date parsing: ISO strings, YYYY-MM-DD, or whatever Date.parse accepts. */
export function normalizeDue(raw: string | undefined): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const t = Date.parse(raw.replace(' at ', ' '));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
