import crypto from 'node:crypto';
import ICAL from 'ical.js';
import type {
  CalendarProvider,
  CalendarRef,
  RemoteCalendar,
  RemoteResource,
  SyncResult,
  SyncWindow,
  WriteResult,
} from './provider';

/**
 * Subscribed calendars: any public .ics / webcal:// address (holidays, school and sports
 * schedules, a shared iCloud calendar's public link, Google's "secret address in iCal format").
 * Read-only. The feed is split into one stored resource per event UID, so the rest of the
 * calendar code treats it like any CalDAV calendar.
 */

export interface FeedSecret {
  url: string;
}

/** Feeds rarely change; download at most this often (the Sync now button always downloads). */
export const FEED_REFRESH_MS = 15 * 60_000;
const MAX_BYTES = 20 * 1024 * 1024;
const TOO_LARGE = 'That calendar feed is too large.';

/** The body as text, stopping as soon as it passes `max` bytes instead of buffering it all. */
async function readText(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error(TOO_LARGE);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
const REMOTE_ID = 'feed';
const PRODID = '-//Hearthboard//Calendar feed//EN';
const NOT_A_CALENDAR = "That address didn't return a calendar (.ics) file.";

/** webcal:// is just https:// for calendar apps. */
export function normalizeFeedUrl(raw: string): string {
  const s = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error('Enter the calendar address, starting with https:// or webcal://');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    throw new Error('Enter the calendar address, starting with https:// or webcal://');
  return u.toString();
}

function normalizeColor(c: unknown): string | null {
  const m = /^#?([0-9a-fA-F]{6})/.exec(String(c ?? '').trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

function parseRoot(ics: string): ICAL.Component {
  if (!/BEGIN:VCALENDAR/i.test(ics)) throw new Error(NOT_A_CALENDAR);
  let jcal: unknown;
  try {
    jcal = ICAL.parse(ics);
  } catch {
    throw new Error(NOT_A_CALENDAR);
  }
  // Several VCALENDARs back to back: use the first.
  const first = Array.isArray(jcal) && Array.isArray(jcal[0]) ? jcal[0] : jcal;
  const root = new ICAL.Component(first as unknown[]);
  if (root.name !== 'vcalendar') throw new Error(NOT_A_CALENDAR);
  return root;
}

export interface ParsedFeed {
  name: string | null;
  color: string | null;
  resources: RemoteResource[];
}

/** Every time zone an event refers to. */
function tzids(vevent: ICAL.Component): Set<string> {
  const out = new Set<string>();
  for (const p of vevent.getAllProperties()) {
    const tz = p.getParameter('tzid');
    if (typeof tz === 'string') out.add(tz);
  }
  return out;
}

/** True when a group of VEVENTs can't show up in the window (one-off events far away). */
function outside(group: ICAL.Component[], window: SyncWindow): boolean {
  const slack = 2 * 86_400_000; // floating and all-day times are read as UTC here
  for (const v of group) {
    if (v.hasProperty('rrule') || v.hasProperty('rdate')) return false;
    try {
      const ev = new ICAL.Event(v);
      const s = ev.startDate.toJSDate().getTime();
      const e = ev.endDate ? ev.endDate.toJSDate().getTime() : s;
      if (s < window.end.getTime() + slack && e > window.start.getTime() - slack) return false;
    } catch {
      return false; // can't tell: keep it and let the reader decide
    }
  }
  return true;
}

/** Split a feed into one small VCALENDAR per event (series + its exceptions share a UID). */
export function splitFeed(ics: string, window?: SyncWindow): ParsedFeed {
  const root = parseRoot(ics);
  const timezones = new Map<string, ICAL.Component>();
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    const id = tz.getFirstPropertyValue('tzid');
    if (typeof id === 'string') timezones.set(id, tz);
  }
  const groups = new Map<string, ICAL.Component[]>();
  for (const v of root.getAllSubcomponents('vevent')) {
    let uid = v.getFirstPropertyValue('uid');
    if (typeof uid !== 'string' || !uid) {
      // No UID (it happens): make a stable one from what the event says.
      uid = crypto.createHash('sha1').update(v.toString()).digest('hex').slice(0, 20);
      v.updatePropertyWithValue('uid', uid);
    }
    const list = groups.get(uid) ?? [];
    list.push(v);
    groups.set(uid, list);
  }

  const resources: RemoteResource[] = [];
  for (const [uid, group] of groups) {
    if (window && outside(group, window)) continue;
    const cal = new ICAL.Component('vcalendar');
    cal.updatePropertyWithValue('version', '2.0');
    cal.updatePropertyWithValue('prodid', PRODID);
    const needed = new Set<string>();
    for (const v of group) for (const tz of tzids(v)) needed.add(tz);
    for (const tz of needed) {
      const comp = timezones.get(tz);
      if (comp) cal.addSubcomponent(new ICAL.Component(comp.toJSON()));
    }
    for (const v of group) cal.addSubcomponent(new ICAL.Component(v.toJSON()));
    const payload = cal.toString();
    resources.push({
      remoteId: uid,
      etag: crypto.createHash('sha1').update(payload).digest('hex').slice(0, 16),
      kind: 'ics',
      payload,
    });
  }

  const name = root.getFirstPropertyValue('x-wr-calname');
  return {
    name: typeof name === 'string' && name.trim() ? name.trim() : null,
    color: normalizeColor(root.getFirstPropertyValue('x-apple-calendar-color')),
    resources,
  };
}

interface Download {
  at: number;
  body: string;
  hash: string;
  etag: string | null;
  lastModified: string | null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export class IcsFeedProvider implements CalendarProvider {
  private last: Download | null = null;
  private readonly url: string;

  constructor(
    secret: FeedSecret,
    private fetchFn: typeof fetch = fetch,
  ) {
    this.url = normalizeFeedUrl(secret.url);
  }

  /** Download the feed. Returns null when the server says it hasn't changed (HTTP 304). */
  private async download(conditional: boolean): Promise<Download | null> {
    const headers: Record<string, string> = {
      accept: 'text/calendar, */*;q=0.5',
      'user-agent': 'Hearthboard (family wall calendar)',
    };
    if (conditional && this.last?.etag) headers['if-none-match'] = this.last.etag;
    if (conditional && this.last?.lastModified)
      headers['if-modified-since'] = this.last.lastModified;
    let res: Response;
    try {
      res = await this.fetchFn(this.url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new Error(`Couldn't reach the calendar feed: ${(err as Error).message}`);
    }
    if (res.status === 304 && this.last) {
      this.last.at = Date.now();
      return null;
    }
    if (res.status === 401 || res.status === 403 || res.status === 404)
      throw new Error(`The calendar feed isn't available (HTTP ${res.status}). Check the address.`);
    if (!res.ok) throw new Error(`Couldn't download the calendar feed: HTTP ${res.status}`);
    const length = Number(res.headers.get('content-length'));
    if (length > MAX_BYTES) throw new Error(TOO_LARGE);
    const body = await readText(res, MAX_BYTES);
    if (!/BEGIN:VCALENDAR/i.test(body)) throw new Error(NOT_A_CALENDAR);
    this.last = {
      at: Date.now(),
      body,
      hash: crypto.createHash('sha1').update(body).digest('hex').slice(0, 16),
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
    };
    return this.last;
  }

  async listCalendars(): Promise<RemoteCalendar[]> {
    // Reuse a download from the last minute (adding an account lists, then syncs).
    const d =
      this.last && Date.now() - this.last.at < 60_000 ? this.last : await this.download(false);
    const parsed = splitFeed(d!.body);
    return [
      {
        remoteId: REMOTE_ID,
        name: parsed.name ?? new URL(this.url).hostname,
        color: parsed.color,
        writable: false,
      },
    ];
  }

  async sync(cal: CalendarRef, window: SyncWindow): Promise<SyncResult> {
    const unchanged: SyncResult = {
      full: false,
      upserts: [],
      deletes: [],
      cursor: cal.cursor,
      unchanged: true,
    };
    const now = Date.now();
    const fresh = this.last && now - this.last.at < 60_000;
    if (!cal.force && !fresh && this.last && now - this.last.at < FEED_REFRESH_MS) {
      // Checked recently; nothing to do unless the stored copy is from another download.
      if (cal.cursor?.startsWith(`${this.last.hash}:`)) return unchanged;
    }
    let d: Download | null = this.last;
    if (!fresh || cal.force) d = (await this.download(!cal.force)) ?? this.last;
    // The window start is part of the cursor so far-off events are picked up as it moves.
    const cursor = `${d!.hash}:${ymd(window.start)}`;
    if (cursor === cal.cursor) return unchanged;
    const parsed = splitFeed(d!.body, window);
    return { full: true, upserts: parsed.resources, deletes: [], cursor };
  }

  async create(): Promise<RemoteResource> {
    throw new Error('Subscribed calendars are read-only.');
  }

  async update(): Promise<WriteResult> {
    throw new Error('Subscribed calendars are read-only.');
  }

  async remove(): Promise<WriteResult> {
    throw new Error('Subscribed calendars are read-only.');
  }
}
