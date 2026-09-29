import type { EventDelete, EventInput, EventPatch } from '@hearthboard/shared';
import { requestTimeout } from '../util';
import type { Occurrence } from './ics';
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

const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar';
/** Loopback redirect for "Desktop app" OAuth clients; the user pastes the final URL back. */
export const GOOGLE_LOOPBACK_REDIRECT = 'http://127.0.0.1:53682/';

export interface GoogleSecret {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface GTime {
  date?: string | null;
  dateTime?: string | null;
  timeZone?: string | null;
}

export interface GEvent {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: GTime;
  end?: GTime;
  recurringEventId?: string;
  originalStartTime?: GTime;
  recurrence?: string[];
}

type Fetch = typeof fetch;

export function googleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${q}`;
}

/** Accepts either the bare code or the whole URL the browser landed on after consent. */
export function extractAuthCode(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (!/[?&]code=/.test(s)) return /^[\w\-./]+$/.test(s) ? s : null;
  try {
    return new URL(s.startsWith('http') ? s : `http://x/${s.replace(/^\/?/, '')}`).searchParams.get(
      'code',
    );
  } catch {
    return null;
  }
}

export async function exchangeGoogleCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
  f: Fetch = fetch,
): Promise<string> {
  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: requestTimeout(),
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const body = (await res.json()) as {
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.refresh_token) {
    throw new Error(
      body.error_description ??
        body.error ??
        'Google did not return a refresh token. Remove the app from your Google account permissions and try again.',
    );
  }
  return body.refresh_token;
}

function iso(t: GTime | undefined): string {
  if (!t) return '';
  if (t.date) return t.date;
  return t.dateTime ? new Date(t.dateTime).toISOString() : '';
}

/** Map a stored Google event instance to an occurrence. */
export function googleOccurrence(payload: string): Occurrence | null {
  const e = JSON.parse(payload) as GEvent;
  if (e.status === 'cancelled' || !e.start) return null;
  return {
    uid: e.id,
    recurrenceId: e.recurringEventId ? iso(e.originalStartTime) || null : null,
    title: e.summary || '(no title)',
    start: iso(e.start),
    end: iso(e.end) || iso(e.start),
    allDay: !!e.start.date,
    location: e.location || null,
    description: e.description || null,
    recurring: !!e.recurringEventId,
  };
}

function times(start: string, end: string, allDay: boolean): { start: GTime; end: GTime } {
  return allDay
    ? {
        start: { date: start.slice(0, 10), dateTime: null },
        end: { date: end.slice(0, 10), dateTime: null },
      }
    : {
        start: { dateTime: new Date(start).toISOString(), date: null },
        end: { dateTime: new Date(end).toISOString(), date: null },
      };
}

function addDays(date: string, days: number): string {
  const d = new Date(date.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Build a PATCH body for one event instance from a board edit. */
export function googlePatchBody(existing: GEvent, patch: EventPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.location !== undefined) body.location = patch.location ?? '';
  if (patch.description !== undefined) body.description = patch.description ?? '';
  if (patch.start || patch.end) {
    const cur = googleOccurrence(JSON.stringify(existing));
    const allDay = patch.allDay ?? cur?.allDay ?? false;
    const start = patch.start ?? cur!.start;
    let end = patch.end;
    if (!end) {
      if (allDay) end = addDays(start, 1);
      else {
        const dur = cur && !cur.allDay ? Date.parse(cur.end) - Date.parse(cur.start) : 3600_000;
        end = new Date(Date.parse(start) + dur).toISOString();
      }
    }
    Object.assign(body, times(start, end, allDay));
  }
  return body;
}

export class GoogleProvider implements CalendarProvider {
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(
    private secret: GoogleSecret,
    private f: Fetch = fetch,
  ) {}

  private async token(force = false): Promise<string> {
    if (!force && this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    const res = await this.f(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: requestTimeout(),
      body: new URLSearchParams({
        client_id: this.secret.clientId,
        client_secret: this.secret.clientSecret,
        refresh_token: this.secret.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const body = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !body.access_token) {
      throw new AuthError(
        body.error === 'invalid_grant'
          ? 'Google access expired or was revoked. Reconnect the account in Settings.'
          : `Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`,
      );
    }
    this.accessToken = body.access_token;
    this.expiresAt = Date.now() + (body.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  private async api<T>(
    path: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<{ status: number; body: T | null }> {
    // Fetch the token first so a slow sign-in doesn't use up this request's time.
    const token = await this.token();
    const res = await this.f(API + path, {
      ...init,
      signal: requestTimeout(),
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 401 && retry) {
      await this.token(true);
      return this.api<T>(path, init, false);
    }
    if (res.status === 412) throw new ConflictError();
    if (res.status === 410) return { status: 410, body: null };
    if (res.status === 204) return { status: 204, body: null };
    const text = await res.text();
    const body = text ? (JSON.parse(text) as T) : null;
    if (!res.ok) {
      const msg =
        (body as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
      if (res.status === 403 || res.status === 401) throw new AuthError(`Google: ${msg}`);
      if (res.status === 404 && init.method === 'DELETE') return { status: 404, body: null };
      throw new Error(`Google Calendar API ${res.status}: ${msg}`);
    }
    return { status: res.status, body };
  }

  async listCalendars(): Promise<RemoteCalendar[]> {
    const out: RemoteCalendar[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ maxResults: '250', ...(pageToken ? { pageToken } : {}) });
      const { body } = await this.api<{
        items?: {
          id: string;
          summary: string;
          summaryOverride?: string;
          backgroundColor?: string;
          accessRole: string;
          deleted?: boolean;
        }[];
        nextPageToken?: string;
      }>(`/users/me/calendarList?${q}`);
      for (const c of body?.items ?? []) {
        if (c.deleted || c.accessRole === 'freeBusyReader') continue;
        out.push({
          remoteId: c.id,
          name: c.summaryOverride || c.summary,
          color: c.backgroundColor ?? null,
          writable: c.accessRole === 'owner' || c.accessRole === 'writer',
        });
      }
      pageToken = body?.nextPageToken;
    } while (pageToken);
    return out;
  }

  async sync(cal: CalendarRef, window: SyncWindow): Promise<SyncResult> {
    const full = !cal.cursor;
    const upserts: RemoteResource[] = [];
    const deletes: string[] = [];
    let pageToken: string | undefined;
    let cursor: string | null = null;
    do {
      const q = new URLSearchParams({
        singleEvents: 'true',
        showDeleted: 'true',
        maxResults: '2500',
      });
      if (pageToken) q.set('pageToken', pageToken);
      if (cal.cursor) q.set('syncToken', cal.cursor);
      else {
        q.set('timeMin', window.start.toISOString());
        q.set('timeMax', window.end.toISOString());
      }
      const { status, body } = await this.api<{
        items?: GEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      }>(`/calendars/${encodeURIComponent(cal.remoteId)}/events?${q}`);
      if (status === 410) return this.sync({ ...cal, cursor: null }, window); // sync token expired
      for (const e of body?.items ?? []) {
        if (e.status === 'cancelled') deletes.push(e.id);
        else upserts.push(toResource(e));
      }
      pageToken = body?.nextPageToken;
      cursor = body?.nextSyncToken ?? cursor;
    } while (pageToken);
    return {
      full,
      upserts,
      deletes,
      cursor,
      unchanged: !full && !upserts.length && !deletes.length,
    };
  }

  async create(cal: CalendarRef, input: Omit<EventInput, 'calendarId'>): Promise<RemoteResource> {
    const body = {
      summary: input.title,
      location: input.location ?? undefined,
      description: input.description ?? undefined,
      ...times(input.start, input.end, input.allDay),
    };
    const { body: e } = await this.api<GEvent>(
      `/calendars/${encodeURIComponent(cal.remoteId)}/events`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    return toResource(e!);
  }

  async update(cal: CalendarRef, res: RemoteResource, patch: EventPatch): Promise<WriteResult> {
    const existing = JSON.parse(res.payload) as GEvent;
    const calPath = `/calendars/${encodeURIComponent(cal.remoteId)}/events`;
    if (patch.scope === 'series' && existing.recurringEventId) {
      const masterId = existing.recurringEventId;
      const { body: master } = await this.api<GEvent>(`${calPath}/${encodeURIComponent(masterId)}`);
      const body: Record<string, unknown> = googlePatchBody(master!, {
        ...patch,
        start: undefined,
        end: undefined,
      });
      if (patch.start && master?.start) {
        const cur = googleOccurrence(res.payload)!;
        const delta = Date.parse(patch.start) - Date.parse(cur.start);
        const dur = patch.end
          ? Date.parse(patch.end) - Date.parse(patch.start)
          : Date.parse(cur.end) - Date.parse(cur.start);
        if (master.start.date) {
          const days = Math.round(delta / 86_400_000);
          const start = addDays(master.start.date, days);
          body.start = { date: start };
          body.end = { date: addDays(start, Math.max(1, Math.round(dur / 86_400_000))) };
        } else {
          const start = Date.parse(master.start.dateTime!) + delta;
          body.start = { dateTime: new Date(start).toISOString(), timeZone: master.start.timeZone };
          body.end = {
            dateTime: new Date(start + dur).toISOString(),
            timeZone: master.end?.timeZone ?? master.start.timeZone,
          };
        }
      }
      await this.api(`${calPath}/${encodeURIComponent(masterId)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: master?.etag ? { 'if-match': master.etag } : {},
      });
      return 'resync';
    }
    const { body: e } = await this.api<GEvent>(`${calPath}/${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(googlePatchBody(existing, patch)),
      headers: res.etag ? { 'if-match': res.etag } : {},
    });
    return toResource(e!);
  }

  async remove(cal: CalendarRef, res: RemoteResource, del: EventDelete): Promise<WriteResult> {
    const existing = JSON.parse(res.payload) as GEvent;
    const series = del.scope === 'series' && existing.recurringEventId;
    const id = series ? existing.recurringEventId! : existing.id;
    await this.api(
      `/calendars/${encodeURIComponent(cal.remoteId)}/events/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: !series && res.etag ? { 'if-match': res.etag } : {},
      },
    );
    return series ? 'resync' : null;
  }
}

function toResource(e: GEvent): RemoteResource {
  return { remoteId: e.id, etag: e.etag ?? null, kind: 'gevent', payload: JSON.stringify(e) };
}
