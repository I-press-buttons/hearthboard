import { describe, expect, it } from 'vitest';
import {
  extractAuthCode,
  googleOccurrence,
  googlePatchBody,
  GoogleProvider,
  type GEvent,
} from '../src/calendars/google';
import { AuthError, ConflictError } from '../src/calendars/provider';

interface Call {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Tiny fake of the Google token + Calendar endpoints. */
function fakeGoogle(routes: (call: Call) => { status?: number; json?: unknown } | undefined) {
  const calls: Call[] = [];
  const f = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const body =
      typeof init.body === 'string'
        ? (() => {
            try {
              return JSON.parse(init.body as string);
            } catch {
              return init.body;
            }
          })()
        : init.body instanceof URLSearchParams
          ? Object.fromEntries(init.body)
          : undefined;
    const call = {
      method: init.method ?? 'GET',
      url,
      body,
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }), {
        status: 200,
      });
    }
    const r = routes(call) ?? { status: 404, json: { error: { message: 'no route' } } };
    return new Response(r.status === 204 ? null : JSON.stringify(r.json ?? {}), {
      status: r.status ?? 200,
    });
  }) as typeof fetch;
  return { f, calls };
}

const secret = { clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt' };
const ev = (id: string, extra: Partial<GEvent> = {}): GEvent => ({
  id,
  etag: `"e-${id}"`,
  status: 'confirmed',
  summary: `Event ${id}`,
  start: { dateTime: '2026-10-05T09:00:00-05:00' },
  end: { dateTime: '2026-10-05T10:00:00-05:00' },
  ...extra,
});

describe('extractAuthCode', () => {
  it('pulls the code out of the loopback URL or accepts a bare code', () => {
    expect(extractAuthCode('http://127.0.0.1:53682/?state=abc&code=4/0AbC-xyz&scope=x')).toBe(
      '4/0AbC-xyz',
    );
    expect(extractAuthCode('  4/0AbC-xyz ')).toBe('4/0AbC-xyz');
    expect(extractAuthCode('?code=zzz&state=1')).toBe('zzz');
    expect(extractAuthCode('')).toBeNull();
  });
});

describe('googleOccurrence', () => {
  it('maps timed, all-day and recurring instances', () => {
    expect(googleOccurrence(JSON.stringify(ev('a')))).toMatchObject({
      start: '2026-10-05T14:00:00.000Z',
      end: '2026-10-05T15:00:00.000Z',
      allDay: false,
      recurring: false,
    });
    expect(
      googleOccurrence(
        JSON.stringify(ev('b', { start: { date: '2026-10-10' }, end: { date: '2026-10-11' } })),
      ),
    ).toMatchObject({ start: '2026-10-10', end: '2026-10-11', allDay: true });
    expect(
      googleOccurrence(
        JSON.stringify(
          ev('c_20261005', {
            recurringEventId: 'c',
            originalStartTime: { dateTime: '2026-10-05T09:00:00-05:00' },
          }),
        ),
      ),
    ).toMatchObject({ recurring: true, recurrenceId: '2026-10-05T14:00:00.000Z' });
    expect(googleOccurrence(JSON.stringify(ev('d', { status: 'cancelled' })))).toBeNull();
  });
});

describe('googlePatchBody', () => {
  it('keeps the duration when only the start moves, and clears the other time field', () => {
    const body = googlePatchBody(ev('a'), { scope: 'instance', start: '2026-10-06T15:00:00Z' });
    expect(body).toEqual({
      start: { dateTime: '2026-10-06T15:00:00.000Z', date: null },
      end: { dateTime: '2026-10-06T16:00:00.000Z', date: null },
    });
    const allDay = googlePatchBody(ev('a'), {
      scope: 'instance',
      start: '2026-10-07',
      allDay: true,
    });
    expect(allDay).toEqual({
      start: { date: '2026-10-07', dateTime: null },
      end: { date: '2026-10-08', dateTime: null },
    });
  });
});

describe('GoogleProvider', () => {
  it('pages through a full sync, then applies incremental changes', async () => {
    const { f, calls } = fakeGoogle(({ url }) => {
      const q = new URL(url).searchParams;
      if (q.get('syncToken') === 'sync-1')
        return {
          json: {
            items: [ev('a', { summary: 'Renamed' }), { id: 'b', status: 'cancelled' }],
            nextSyncToken: 'sync-2',
          },
        };
      if (q.get('pageToken') === 'p2')
        return { json: { items: [ev('b')], nextSyncToken: 'sync-1' } };
      return { json: { items: [ev('a')], nextPageToken: 'p2' } };
    });
    const p = new GoogleProvider(secret, f);
    const win = { start: new Date('2026-07-01'), end: new Date('2027-07-01') };
    const full = await p.sync({ remoteId: 'family@group.calendar.google.com', cursor: null }, win);
    expect(full).toMatchObject({ full: true, cursor: 'sync-1', deletes: [] });
    expect(full.upserts.map((r) => r.remoteId)).toEqual(['a', 'b']);
    expect(calls[1].url).toContain('singleEvents=true');
    expect(calls[1].url).toContain('timeMin=');
    expect(calls[1].headers.authorization).toBe('Bearer at-1');

    const inc = await p.sync(
      { remoteId: 'family@group.calendar.google.com', cursor: 'sync-1' },
      win,
    );
    expect(inc).toMatchObject({ full: false, cursor: 'sync-2', deletes: ['b'] });
    expect(JSON.parse(inc.upserts[0].payload).summary).toBe('Renamed');
  });

  it('falls back to a full sync when the sync token expired (410)', async () => {
    const { f } = fakeGoogle(({ url }) =>
      new URL(url).searchParams.get('syncToken')
        ? { status: 410 }
        : { json: { items: [ev('a')], nextSyncToken: 'fresh' } },
    );
    const res = await new GoogleProvider(secret, f).sync(
      { remoteId: 'x', cursor: 'stale' },
      { start: new Date(), end: new Date() },
    );
    expect(res).toMatchObject({ full: true, cursor: 'fresh' });
  });

  it('patches instances with If-Match and maps 412 to a conflict', async () => {
    let status = 200;
    const { f, calls } = fakeGoogle(({ method }) =>
      method === 'PATCH' ? { status, json: ev('a', { etag: '"e2"' }) } : undefined,
    );
    const p = new GoogleProvider(secret, f);
    const res = {
      remoteId: 'a',
      etag: '"e-a"',
      kind: 'gevent' as const,
      payload: JSON.stringify(ev('a')),
    };
    const out = await p.update({ remoteId: 'primary', cursor: null }, res, {
      scope: 'instance',
      title: 'New',
    });
    expect(out).toMatchObject({ remoteId: 'a', etag: '"e2"' });
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.headers['if-match']).toBe('"e-a"');
    expect(patch.body).toEqual({ summary: 'New' });
    status = 412;
    await expect(
      p.update({ remoteId: 'primary', cursor: null }, res, { scope: 'instance', title: 'x' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('shifts a whole series from its master event, keeping its time zone', async () => {
    const master = ev('m', {
      start: { dateTime: '2026-09-07T09:00:00-05:00', timeZone: 'America/Chicago' },
      end: { dateTime: '2026-09-07T10:00:00-05:00', timeZone: 'America/Chicago' },
      recurrence: ['RRULE:FREQ=WEEKLY'],
    });
    const { f, calls } = fakeGoogle(({ method, url }) => {
      if (url.endsWith('/events/m') && method === 'GET') return { json: master };
      if (url.endsWith('/events/m') && method === 'PATCH') return { json: master };
      return undefined;
    });
    const instance = ev('m_20261005', {
      recurringEventId: 'm',
      originalStartTime: { dateTime: '2026-10-05T09:00:00-05:00' },
    });
    const out = await new GoogleProvider(secret, f).update(
      { remoteId: 'primary', cursor: null },
      {
        remoteId: instance.id,
        etag: instance.etag!,
        kind: 'gevent',
        payload: JSON.stringify(instance),
      },
      { scope: 'series', start: '2026-10-05T15:30:00Z', end: '2026-10-05T16:30:00Z' },
    );
    expect(out).toBe('resync');
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toMatchObject({
      start: { dateTime: '2026-09-07T15:30:00.000Z', timeZone: 'America/Chicago' },
      end: { dateTime: '2026-09-07T16:30:00.000Z', timeZone: 'America/Chicago' },
    });
  });

  it('reports a revoked refresh token clearly', async () => {
    const f = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as typeof fetch;
    await expect(new GoogleProvider(secret, f).listCalendars()).rejects.toThrow(AuthError);
    await expect(new GoogleProvider(secret, f).listCalendars()).rejects.toThrow(/Reconnect/);
  });
});
