import crypto from 'node:crypto';
import type { EventDelete, EventInput, EventPatch } from '@hearthboard/shared';
import { buildIcs, patchIcs, removeOccurrence } from './ics';
import {
  ConflictError,
  type CalendarProvider,
  type CalendarRef,
  type RemoteCalendar,
  type RemoteResource,
  type SyncResult,
  type WriteResult,
} from './provider';

/** In-memory stand-in for a CalDAV server, used by demo mode and tests. */
export class DemoProvider implements CalendarProvider {
  /** remoteId -> (href -> resource) */
  readonly store = new Map<string, Map<string, RemoteResource>>();
  readonly writes: { op: string; remoteId: string; patch?: unknown }[] = [];
  private version = 0;

  constructor(private calendars: RemoteCalendar[] = DEMO_CALENDARS) {
    for (const c of calendars) this.store.set(c.remoteId, new Map());
  }

  static seeded(now = new Date()): DemoProvider {
    const p = new DemoProvider();
    for (const [cal, input] of demoEvents(now))
      p.put(cal, buildIcs(input, `${crypto.randomUUID()}@demo`));
    const trash = buildIcs(
      { title: 'Trash night', start: at(now, -7, 19), end: at(now, -7, 19.5), allDay: false },
      'trash-night@demo',
    );
    p.put(
      DEMO_CALENDARS[0].remoteId,
      trash.replace('END:VEVENT', 'RRULE:FREQ=WEEKLY\r\nEND:VEVENT'),
    );
    return p;
  }

  /** Add a raw iCalendar object (used for seeding recurring demo events). */
  put(
    calendarRemoteId: string,
    ics: string,
    href = `${calendarRemoteId}${crypto.randomUUID()}.ics`,
  ): RemoteResource {
    const res: RemoteResource = {
      remoteId: href,
      etag: `"${++this.version}"`,
      kind: 'ics',
      payload: ics,
    };
    this.store.get(calendarRemoteId)!.set(href, res);
    return res;
  }

  async listCalendars() {
    return this.calendars;
  }

  async sync(cal: CalendarRef): Promise<SyncResult> {
    const cursor = String(this.version);
    if (cal.cursor === cursor)
      return { full: false, upserts: [], deletes: [], cursor, unchanged: true };
    return {
      full: true,
      upserts: [...(this.store.get(cal.remoteId)?.values() ?? [])],
      deletes: [],
      cursor,
    };
  }

  async create(cal: CalendarRef, input: Omit<EventInput, 'calendarId'>): Promise<RemoteResource> {
    this.writes.push({ op: 'create', remoteId: cal.remoteId, patch: input });
    return this.put(cal.remoteId, buildIcs(input, `${crypto.randomUUID()}@demo`));
  }

  private current(cal: CalendarRef, res: RemoteResource): RemoteResource {
    const cur = this.store.get(cal.remoteId)?.get(res.remoteId);
    if (!cur) throw new Error('Event not found');
    if (res.etag && cur.etag !== res.etag) {
      throw new ConflictError();
    }
    return cur;
  }

  async update(cal: CalendarRef, res: RemoteResource, patch: EventPatch): Promise<WriteResult> {
    const cur = this.current(cal, res);
    this.writes.push({ op: 'update', remoteId: res.remoteId, patch });
    return this.put(cal.remoteId, patchIcs(cur.payload, patch), cur.remoteId);
  }

  async remove(cal: CalendarRef, res: RemoteResource, del: EventDelete): Promise<WriteResult> {
    const cur = this.current(cal, res);
    this.writes.push({ op: 'delete', remoteId: res.remoteId, patch: del });
    if (del.recurrenceId && del.scope === 'instance') {
      return this.put(cal.remoteId, removeOccurrence(cur.payload, del.recurrenceId), cur.remoteId);
    }
    this.store.get(cal.remoteId)!.delete(res.remoteId);
    this.version++;
    return null;
  }
}

export const DEMO_CALENDARS: RemoteCalendar[] = [
  { remoteId: '/demo/family/', name: 'Family', color: '#f59e0b', writable: true },
  { remoteId: '/demo/school/', name: 'School', color: '#38bdf8', writable: true },
  { remoteId: '/demo/work/', name: 'Work', color: '#a78bfa', writable: true },
];

function at(base: Date, dayOffset: number, hour: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  return d.toISOString();
}

function day(base: Date, dayOffset: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function demoEvents(now: Date): [string, Omit<EventInput, 'calendarId'>][] {
  const [fam, school, work] = DEMO_CALENDARS.map((c) => c.remoteId);
  const ev = (title: string, d: number, h: number, dur = 1, location?: string) => ({
    title,
    start: at(now, d, h),
    end: at(now, d, h + dur),
    allDay: false,
    location: location ?? null,
  });
  return [
    [fam, ev('Pancake breakfast', 0, 8, 1, 'Kitchen')],
    [school, ev('Soccer practice', 0, 16, 1.5, 'Field 3')],
    [work, ev('Team sync', 1, 10)],
    [fam, ev('Dentist – Emma', 1, 14, 1, 'Smile Dental')],
    [school, ev('Piano lesson', 2, 17)],
    [fam, ev('Grocery run', 3, 11)],
    [fam, { title: 'Grandma visiting', start: day(now, 4), end: day(now, 7), allDay: true }],
    [work, ev('Quarterly review', 5, 13, 2)],
    [school, { title: 'Field trip', start: day(now, 8), end: day(now, 9), allDay: true }],
    [fam, ev('Movie night', 6, 19, 2, 'Living room')],
    [fam, ev('Church', 9, 10, 2)],
    [school, ev('Parent–teacher conference', 12, 18)],
    [fam, { title: 'Pay bills', start: day(now, -2), end: day(now, -1), allDay: true }],
  ];
}
