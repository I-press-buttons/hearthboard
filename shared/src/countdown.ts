import type { CountdownEntry } from './widgets';

export interface CountdownItem {
  title: string;
  emoji: string;
  /** YYYY-MM-DD of the (next) date being counted down to. */
  date: string;
  /** Whole days from today (local time); 0 = today. */
  days: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local-midnight Date for a YYYY-MM-DD string. Feb 29 falls back to Feb 28 in other years. */
function dateIn(year: number, month: number, day: number): Date {
  const last = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, Math.min(day, last));
}

function daysBetween(from: Date, to: Date): number {
  // Round, because a daylight-saving change makes one day 23 or 25 hours long.
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Upcoming countdowns, soonest first. Dates already past are dropped, except yearly ones, which
 * move to their next anniversary. Today's entries stay (days = 0) for the whole day.
 */
export function upcomingCountdowns(entries: CountdownEntry[], now = new Date()): CountdownItem[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: CountdownItem[] = [];
  for (const e of entries) {
    const [y, m, d] = e.date.split('-').map(Number);
    if (!y || !m || !d) continue;
    let target = dateIn(y, m, d);
    if (e.yearly) {
      target = dateIn(today.getFullYear(), m, d);
      if (target < today) target = dateIn(today.getFullYear() + 1, m, d);
    }
    const days = daysBetween(today, target);
    if (days < 0) continue;
    out.push({ title: e.title, emoji: e.emoji, date: ymd(target), days });
  }
  return out.sort((a, b) => a.days - b.days || a.title.localeCompare(b.title));
}

/** "Today!", "Tomorrow", "12 days" or, for the kids, "1 sleep" / "12 sleeps". */
export function countdownLabel(days: number, unit: 'days' | 'sleeps'): string {
  if (days <= 0) return 'Today!';
  if (unit === 'sleeps') return `${days} ${days === 1 ? 'sleep' : 'sleeps'}`;
  if (days === 1) return 'Tomorrow';
  return `${days} days`;
}

/** Take a keyword out of an event title: "Beach trip #countdown" -> "Beach trip". */
export function stripKeyword(title: string, keyword: string): string {
  if (!keyword) return title.trim();
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return title
    .replace(new RegExp(escaped, 'gi'), ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
