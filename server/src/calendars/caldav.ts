import crypto from 'node:crypto';
import { createDAVClient, type DAVCalendar, type DAVCalendarObject } from 'tsdav';
import type { EventDelete, EventInput, EventPatch } from '@hearthboard/shared';
import { buildIcs, patchIcs, removeOccurrence } from './ics';
import {
  AuthError,
  ConflictError,
  type CalendarProvider,
  type CalendarRef,
  type RemoteCalendar,
  type RemoteResource,
  type SyncResult,
  type SyncWindow,
  type WriteResult,
} from './provider';

export const ICLOUD_CALDAV_URL = 'https://caldav.icloud.com';

export interface CalDavSecret {
  serverUrl: string;
  username: string;
  /** For iCloud: an app-specific password from account.apple.com. */
  password: string;
}

type Client = Awaited<ReturnType<typeof createDAVClient>>;

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && '_cdata' in v) return String((v as { _cdata: unknown })._cdata);
  return v === undefined || v === null ? '' : String(v);
}

function normalizeColor(c: unknown): string | null {
  const s = asString(c).trim();
  const m = /^#?([0-9a-fA-F]{6})/.exec(s);
  return m ? `#${m[1].toLowerCase()}` : null;
}

async function check(res: Response, what: string) {
  if (res.ok) return;
  if (res.status === 412) throw new ConflictError();
  if (res.status === 401 || res.status === 403)
    throw new AuthError(`${what}: not allowed (${res.status})`);
  throw new Error(`${what} failed: HTTP ${res.status} ${res.statusText}`);
}

/** CalDAV provider: iCloud, Synology Calendar, Nextcloud, Radicale, Fastmail... */
export class CalDavProvider implements CalendarProvider {
  private clientPromise: Promise<Client> | null = null;

  constructor(private secret: CalDavSecret) {}

  private client(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = createDAVClient({
        serverUrl: this.secret.serverUrl,
        credentials: { username: this.secret.username, password: this.secret.password },
        authMethod: 'Basic',
        defaultAccountType: 'caldav',
      }).catch((err: unknown) => {
        this.clientPromise = null;
        const msg = err instanceof Error ? err.message : String(err);
        if (/401|unauthori|invalid credentials/i.test(msg)) {
          throw new AuthError('The CalDAV server rejected the username or password.');
        }
        throw err;
      });
    }
    return this.clientPromise;
  }

  async listCalendars(): Promise<RemoteCalendar[]> {
    const client = await this.client();
    const cals = await client.fetchCalendars();
    return cals
      .filter((c) => !c.components || c.components.includes('VEVENT'))
      .map((c) => ({
        remoteId: c.url,
        name: asString(c.displayName) || 'Calendar',
        color: normalizeColor(c.calendarColor),
        writable: true,
      }));
  }

  async sync(cal: CalendarRef, window: SyncWindow): Promise<SyncResult> {
    const client = await this.client();
    const collection = { url: cal.remoteId, ctag: cal.cursor ?? undefined } as DAVCalendar;
    const { isDirty, newCtag } = await client.isCollectionDirty({ collection });
    if (cal.cursor && !isDirty) {
      return { full: false, upserts: [], deletes: [], cursor: cal.cursor, unchanged: true };
    }
    const objects = await client.fetchCalendarObjects({
      calendar: collection,
      timeRange: { start: window.start.toISOString(), end: window.end.toISOString() },
    });
    return {
      full: true,
      upserts: objects.filter((o) => typeof o.data === 'string' && o.data).map(toResource),
      deletes: [],
      cursor: newCtag || null,
    };
  }

  private async fetchOne(calendarUrl: string, url: string): Promise<RemoteResource | null> {
    const client = await this.client();
    const [obj] = await client.fetchCalendarObjects({
      calendar: { url: calendarUrl } as DAVCalendar,
      objectUrls: [url],
    });
    return obj?.data ? toResource(obj) : null;
  }

  async create(cal: CalendarRef, input: Omit<EventInput, 'calendarId'>): Promise<RemoteResource> {
    const client = await this.client();
    const uid = `${crypto.randomUUID()}@hearthboard`;
    const ics = buildIcs(input, uid);
    const filename = `${uid.replace(/[^A-Za-z0-9_-]/g, '-')}.ics`;
    const res = await client.createCalendarObject({
      calendar: { url: cal.remoteId } as DAVCalendar,
      filename,
      iCalString: ics,
    });
    await check(res, 'Creating the event');
    const url = new URL(filename, cal.remoteId.endsWith('/') ? cal.remoteId : cal.remoteId + '/')
      .href;
    return (
      (await this.fetchOne(cal.remoteId, url)) ?? {
        remoteId: url,
        etag: res.headers.get('etag'),
        kind: 'ics',
        payload: ics,
      }
    );
  }

  private async put(cal: CalendarRef, res: RemoteResource, data: string): Promise<RemoteResource> {
    const client = await this.client();
    const out = await client.updateCalendarObject({
      calendarObject: { url: res.remoteId, data, etag: res.etag ?? undefined },
    });
    await check(out, 'Saving the event');
    return (
      (await this.fetchOne(cal.remoteId, res.remoteId)) ?? {
        ...res,
        etag: out.headers.get('etag'),
        payload: data,
      }
    );
  }

  async update(cal: CalendarRef, res: RemoteResource, patch: EventPatch): Promise<WriteResult> {
    return this.put(cal, res, patchIcs(res.payload, patch));
  }

  async remove(cal: CalendarRef, res: RemoteResource, del: EventDelete): Promise<WriteResult> {
    if (del.recurrenceId && del.scope === 'instance') {
      return this.put(cal, res, removeOccurrence(res.payload, del.recurrenceId));
    }
    const client = await this.client();
    const out = await client.deleteCalendarObject({
      calendarObject: { url: res.remoteId, etag: res.etag ?? undefined },
    });
    if (out.status !== 404) await check(out, 'Deleting the event');
    return null;
  }
}

function toResource(o: DAVCalendarObject): RemoteResource {
  return { remoteId: o.url, etag: o.etag ?? null, kind: 'ics', payload: o.data as string };
}
