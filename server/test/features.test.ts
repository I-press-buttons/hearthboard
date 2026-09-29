import { afterEach, describe, expect, it } from 'vitest';
import type { LiveMessage } from '@hearthboard/shared';
import { defaultProviderFactory, syncWindow } from '../src/calendars/service';
import {
  IcsFeedProvider,
  normalizeFeedUrl,
  splitFeed,
  type FeedSecret,
} from '../src/calendars/feed';
import { demoForecast, parseForecast } from '../src/weather';
import { testApp } from './helpers';

type App = Awaited<ReturnType<typeof testApp>>;
let app: App | null = null;
afterEach(async () => {
  await app?.app.close();
  app = null;
});

async function addMember(a: App, username = 'sam') {
  await a.inject('POST', '/api/users', { username, name: 'Sam', password: `${username}-password` });
  const c = a.client();
  await c.signIn(username, `${username}-password`);
  return c;
}

// ---------------- weather ----------------

const OPEN_METEO = {
  current: {
    temperature_2m: 18.4,
    apparent_temperature: 17.1,
    weather_code: 61,
    is_day: 1,
    wind_speed_10m: 14.2,
    relative_humidity_2m: 71,
  },
  daily: {
    time: ['2026-09-29', '2026-09-30'],
    weather_code: [61, 2],
    temperature_2m_max: [20.5, 23.1],
    temperature_2m_min: [12.2, null],
    precipitation_probability_max: [80, 10],
  },
};

function fakeFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const f = (async (input: string | URL) => {
    calls.push(String(input));
    return handler(String(input));
  }) as typeof fetch;
  return { f, calls };
}

describe('weather', () => {
  it('parses Open-Meteo and fills gaps', () => {
    const w = parseForecast(OPEN_METEO, 1);
    expect(w.current).toEqual({
      temp: 18.4,
      feelsLike: 17.1,
      code: 61,
      isDay: true,
      wind: 14.2,
      humidity: 71,
    });
    expect(w.daily[1]).toEqual({
      date: '2026-09-30',
      code: 2,
      max: 23.1,
      min: 18.4,
      precipChance: 10,
    });
    expect(demoForecast().daily).toHaveLength(8);
  });

  it('is public, shared between screens and cached', async () => {
    const { f, calls } = fakeFetch(() => Response.json(OPEN_METEO));
    app = await testApp({}, { weatherFetch: f });
    const a = await app.inject('GET', '/api/weather?lat=30.27&lon=-97.74');
    expect(a.status).toBe(200);
    expect(a.body.current.temp).toBe(18.4);
    expect(a.body.stale).toBe(false);
    await app.inject('GET', '/api/weather?lat=30.271&lon=-97.742');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('latitude=30.270');
    expect(calls[0]).toContain('timezone=auto');
  });

  it('keeps showing the last forecast when Open-Meteo is down', async () => {
    let up = true;
    const { f } = fakeFetch(() =>
      up ? Response.json(OPEN_METEO) : new Response('', { status: 503 }),
    );
    app = await testApp({}, { weatherFetch: f });
    const now = Date.now();
    await app.weather.forecast(1, 2, now);
    up = false;
    const later = await app.weather.forecast(1, 2, now + 20 * 60_000);
    expect(later.stale).toBe(true);
    expect(later.current.temp).toBe(18.4);
    await expect(app.weather.forecast(5, 5, now)).rejects.toThrow(/unavailable/);
  });

  it('rejects bad coordinates and needs a sign-in to look places up', async () => {
    const { f } = fakeFetch((url) =>
      url.includes('geocoding')
        ? Response.json({
            results: [
              {
                name: 'Austin',
                latitude: 30.27,
                longitude: -97.74,
                country: 'United States',
                admin1: 'Texas',
              },
            ],
          })
        : Response.json(OPEN_METEO),
    );
    app = await testApp({}, { weatherFetch: f });
    expect((await app.inject('GET', '/api/weather?lat=91&lon=0')).status).toBe(400);
    expect((await app.inject('GET', '/api/weather/places?q=Austin')).status).toBe(401);
    await app.login();
    expect((await app.inject('GET', '/api/weather/places?q=Austin')).body).toEqual([
      { name: 'Austin', region: 'Texas, United States', latitude: 30.27, longitude: -97.74 },
    ]);
  });
});

// ---------------- meal plan ----------------

describe('meal plan', () => {
  it('saves, lists and clears meals, and tells screens', async () => {
    app = await testApp();
    const seen: LiveMessage[] = [];
    app.live.subscribe((m) => seen.push(m));
    expect(
      (await app.inject('PUT', '/api/meals/2026-10-01/dinner', { text: 'Tacos' })).status,
    ).toBe(401);
    await app.login();
    await app.inject('PUT', '/api/meals/2026-10-01/dinner', { text: '  Tacos ' });
    await app.inject('PUT', '/api/meals/2026-10-01/breakfast', { text: 'Waffles' });
    await app.inject('PUT', '/api/meals/2026-10-08/dinner', { text: 'Out of range' });
    const week = await app.inject('GET', '/api/meals?start=2026-09-29&days=7');
    expect(week.body).toEqual([
      { date: '2026-10-01', slot: 'breakfast', text: 'Waffles' },
      { date: '2026-10-01', slot: 'dinner', text: 'Tacos' },
    ]);
    expect(seen).toContainEqual({ topic: 'meals' });
    await app.inject('PUT', '/api/meals/2026-10-01/dinner', { text: '' });
    expect((await app.inject('GET', '/api/meals?start=2026-10-01&days=1')).body).toHaveLength(1);
  });

  it('rejects bad dates and meals', async () => {
    app = await testApp();
    await app.login();
    expect((await app.inject('PUT', '/api/meals/tomorrow/dinner', { text: 'x' })).status).toBe(400);
    expect((await app.inject('PUT', '/api/meals/2026-10-01/snack', { text: 'x' })).status).toBe(
      400,
    );
    expect((await app.inject('GET', '/api/meals?days=500')).status).toBe(400);
  });
});

// ---------------- notes ----------------

describe('family notes', () => {
  it('posts notes that show until they expire', async () => {
    app = await testApp();
    await app.login();
    const res = await app.inject('POST', '/api/notes', {
      text: 'Back at 6',
      color: 'blue',
      expiresInHours: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ text: 'Back at 6', color: 'blue', author: 'Admin' });
    await app.inject('POST', '/api/notes', { text: 'Forever', expiresInHours: null });
    const anon = app.client();
    expect(
      (await anon.inject('GET', '/api/notes')).body.map((n: { text: string }) => n.text),
    ).toEqual(['Forever', 'Back at 6']);
    // An hour later the first one is gone.
    const later = Date.now() + 3600_000 + 1000;
    expect(app.notes.list(later).map((n) => n.text)).toEqual(['Forever']);
    expect(app.notes.purgeExpired(later)).toBe(true);
    expect((await app.inject('POST', '/api/notes', { text: '   ' })).status).toBe(400);
  });

  it('lets only the author or an admin take a note down', async () => {
    app = await testApp();
    await app.login();
    const sam = await addMember(app);
    const mine = (await app.inject('POST', '/api/notes', { text: "Admin's" })).body;
    const theirs = (await sam.inject('POST', '/api/notes', { text: "Sam's" })).body;
    const del = await sam.inject('DELETE', `/api/notes/${mine.id}`);
    expect(del.status).toBe(403);
    expect(del.body.error).toMatch(/Only Admin/);
    expect((await sam.inject('DELETE', `/api/notes/${theirs.id}`)).status).toBe(200);
    expect((await app.inject('DELETE', `/api/notes/${mine.id}`)).status).toBe(200);
    expect((await app.inject('DELETE', `/api/notes/${mine.id}`)).status).toBe(404);
  });
});

// ---------------- calendar feeds ----------------

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000);

function feed(extra = '') {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//School//EN
X-WR-CALNAME:Lincoln Elementary
X-APPLE-CALENDAR-COLOR:#34D399FF
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:STANDARD
DTSTART:19701101T020000
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700308T020000
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:no-school
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:${ymd(daysFromNow(10))}
DTEND;VALUE=DATE:${ymd(daysFromNow(11))}
SUMMARY:No school
END:VEVENT
BEGIN:VEVENT
UID:assembly
DTSTAMP:20260101T000000Z
DTSTART;TZID=America/New_York:${ymd(daysFromNow(-14))}T090000
DTEND;TZID=America/New_York:${ymd(daysFromNow(-14))}T100000
RRULE:FREQ=WEEKLY;COUNT=8
SUMMARY:Assembly
END:VEVENT
BEGIN:VEVENT
UID:assembly
DTSTAMP:20260101T000000Z
RECURRENCE-ID;TZID=America/New_York:${ymd(daysFromNow(-7))}T090000
DTSTART;TZID=America/New_York:${ymd(daysFromNow(-7))}T110000
DTEND;TZID=America/New_York:${ymd(daysFromNow(-7))}T120000
SUMMARY:Assembly (moved)
END:VEVENT
BEGIN:VEVENT
UID:ancient
DTSTAMP:20010101T000000Z
DTSTART;VALUE=DATE:20010105
SUMMARY:Long ago
END:VEVENT
BEGIN:VEVENT
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:${ymd(daysFromNow(3))}
SUMMARY:Picture day
END:VEVENT
${extra}END:VCALENDAR`.replace(/\n/g, '\r\n');
}

describe('calendar feeds', () => {
  it('turns webcal:// into https:// and rejects other addresses', () => {
    expect(normalizeFeedUrl(' webcal://example.com/cal.ics ')).toBe('https://example.com/cal.ics');
    expect(() => normalizeFeedUrl('ftp://example.com/x.ics')).toThrow(/https:\/\//);
    expect(() => normalizeFeedUrl('not an address')).toThrow(/https:\/\//);
  });

  it('splits a feed into one resource per event, with the time zones it needs', () => {
    const parsed = splitFeed(feed(), syncWindow());
    expect(parsed.name).toBe('Lincoln Elementary');
    expect(parsed.color).toBe('#34d399');
    const ids = parsed.resources.map((r) => r.remoteId);
    expect(ids).toContain('no-school');
    expect(ids).toContain('assembly');
    expect(ids).not.toContain('ancient'); // outside the cached window
    expect(ids).toHaveLength(3); // + the event without a UID
    const assembly = parsed.resources.find((r) => r.remoteId === 'assembly')!;
    expect(assembly.payload).toContain('TZID:America/New_York');
    expect(assembly.payload.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    const noSchool = parsed.resources.find((r) => r.remoteId === 'no-school')!;
    expect(noSchool.payload).not.toContain('VTIMEZONE');
    // Stable ids for events without a UID, so they aren't re-added on every sync.
    expect(splitFeed(feed(), syncWindow()).resources.map((r) => r.remoteId)).toEqual(ids);
    expect(() => splitFeed('<html>nope</html>')).toThrow(/didn't return a calendar/);
  });

  it('downloads at most every 15 minutes unless forced, and uses If-None-Match', async () => {
    const headers: Record<string, string>[] = [];
    let body = feed();
    const f = (async (_url: string | URL, init: RequestInit = {}) => {
      const h = (init.headers ?? {}) as Record<string, string>;
      headers.push(h);
      if (h['if-none-match'] === '"v1"' && body === feed())
        return new Response(null, { status: 304 });
      return new Response(body, { status: 200, headers: { etag: '"v1"' } });
    }) as typeof fetch;
    const p = new IcsFeedProvider({ url: 'webcal://school.example/cal.ics' }, f);
    const win = syncWindow();
    const first = await p.sync({ remoteId: 'feed', cursor: null }, win);
    expect(first.full).toBe(true);
    expect(first.upserts).toHaveLength(3);
    // Straight away: no download, nothing changed.
    const again = await p.sync({ remoteId: 'feed', cursor: first.cursor }, win);
    expect(again.unchanged).toBe(true);
    expect(headers).toHaveLength(1);
    // "Sync now" downloads even so, but the content is the same.
    const forced = await p.sync({ remoteId: 'feed', cursor: first.cursor, force: true }, win);
    expect(forced.unchanged).toBe(true);
    expect(headers).toHaveLength(2);
    // A changed feed is picked up by a forced sync.
    body = feed(`BEGIN:VEVENT
UID:new
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:${ymd(daysFromNow(5))}
SUMMARY:Book fair
END:VEVENT
`);
    const changed = await p.sync({ remoteId: 'feed', cursor: first.cursor, force: true }, win);
    expect(changed.upserts.map((r) => r.remoteId)).toContain('new');
  });

  it('subscribes from Settings and shows read-only events', async () => {
    const f = (async () => new Response(feed(), { status: 200 })) as typeof fetch;
    app = await testApp(
      {},
      {
        providerFactory: (kind, secret) =>
          kind === 'ics'
            ? new IcsFeedProvider(secret as FeedSecret, f)
            : defaultProviderFactory(kind, secret),
      },
    );
    await app.login();
    expect((await app.inject('POST', '/api/accounts/ics', { url: 'gopher://x' })).status).toBe(400);
    const res = await app.inject('POST', '/api/accounts/ics', {
      url: 'webcal://school.example/cal.ics',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'ics', name: 'Lincoln Elementary' });
    await app.calendars.syncAll();
    const cals = (await app.inject('GET', '/api/calendars')).body;
    expect(cals).toEqual([
      expect.objectContaining({ name: 'Lincoln Elementary', color: '#34d399', writable: false }),
    ]);
    const from = daysFromNow(-20).toISOString();
    const to = daysFromNow(30).toISOString();
    const events = (await app.inject('GET', `/api/events?start=${from}&end=${to}`)).body as {
      title: string;
      editable: boolean;
      resourceId: string;
    }[];
    const titles = events.map((e) => e.title);
    expect(titles).toContain('No school');
    expect(titles).toContain('Assembly (moved)');
    expect(titles).toContain('Picture day');
    expect(events.every((e) => !e.editable)).toBe(true);
    const edit = await app.inject('PATCH', `/api/events/${events[0].resourceId}`, { title: 'x' });
    expect(edit.status).toBe(403);
  });

  it('reports addresses that are not calendars', async () => {
    const f = (async () => new Response('<html>Login</html>', { status: 200 })) as typeof fetch;
    app = await testApp(
      {},
      { providerFactory: (_kind, secret) => new IcsFeedProvider(secret as FeedSecret, f) },
    );
    await app.login();
    const res = await app.inject('POST', '/api/accounts/ics', { url: 'https://example.com/' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/didn't return a calendar/);
    expect((await app.inject('GET', '/api/accounts')).body).toEqual([]);
  });
});

// ---------------- touch-screen mode ----------------

describe('touch-screen mode', () => {
  it('lets a touch-screen board tick its own checklists and reminders, and nothing else', async () => {
    app = await testApp();
    const board = (await app.inject('GET', '/api/boards/main')).body;
    const list = board.widgets.find((w: { type: string }) => w.type === 'checklist').config
      .checklistId as string;
    const item = (await app.inject('GET', `/api/checklists/${list}`)).body.items[0];
    const tv = app.client();
    const tick = (headers: Record<string, string>, body: unknown = { done: true }) =>
      tv.inject('PATCH', `/api/checklists/${list}/items/${item.id}`, body, headers);
    const onMain = { 'x-hearthboard-board': 'main' };

    expect((await tick({})).status).toBe(401);
    expect((await tick(onMain)).status).toBe(401); // touch mode is off

    await app.login();
    await app.inject('PUT', '/api/boards/main', { ...board, interactive: true });
    expect((await tick(onMain)).status).toBe(200);
    expect((await app.inject('GET', `/api/checklists/${list}`)).body.items[0].done).toBe(true);
    // Only ticking: no renaming, adding or deleting.
    expect((await tick(onMain, { text: 'hacked' })).status).toBe(401);
    expect((await tick(onMain, { done: false, text: 'hacked' })).status).toBe(401);
    expect(
      (await tv.inject('POST', `/api/checklists/${list}/items`, { text: 'x' }, onMain)).status,
    ).toBe(401);
    // Only checklists the board shows.
    const other = (await app.inject('POST', '/api/checklists', { name: 'Private' })).body;
    const withItem = (await app.inject('POST', `/api/checklists/${other.id}/items`, { text: 'a' }))
      .body;
    expect(
      (
        await tv.inject(
          'PATCH',
          `/api/checklists/${other.id}/items/${withItem.items[0].id}`,
          { done: true },
          onMain,
        )
      ).status,
    ).toBe(401);

    // Reminders from the lists the widget shows.
    app.reminders.ingest({ reminders: [{ title: 'Milk', list: 'Groceries' }] });
    const [r] = (await app.inject('GET', '/api/reminders')).body;
    expect((await tv.inject('POST', `/api/reminders/${r.id}/complete`, {}, onMain)).status).toBe(
      200,
    );
    const rem = board.widgets.find((w: { type: string }) => w.type === 'reminders');
    rem.config = { lists: ['Family'] };
    await app.inject('PUT', '/api/boards/main', { ...board, interactive: true });
    expect((await tv.inject('POST', `/api/reminders/${r.id}/complete`, {}, onMain)).status).toBe(
      401,
    );
  });
});

// ---------------- layout import ----------------

describe('layout import', () => {
  it('imports an exported layout as a new board of your own', async () => {
    app = await testApp();
    await app.login();
    const sam = await addMember(app);
    const main = (await app.inject('GET', '/api/boards/main')).body;
    const res = await sam.inject('POST', '/api/boards', {
      layout: {
        hearthboard: 1,
        exportedAt: new Date().toISOString(),
        board: { ...main, theme: 'forest' },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.id).not.toBe('main');
    expect(res.body).toMatchObject({ name: 'Home', theme: 'forest', schedule: [] });
    expect(res.body.widgets).toHaveLength(main.widgets.length);
    expect(res.body.widgets[0].id).not.toBe(main.widgets[0].id);
    const mine = (await sam.inject('GET', '/api/boards')).body.map((b: { id: string }) => b.id);
    expect(mine).toContain(res.body.id);

    const bad = await sam.inject('POST', '/api/boards', { layout: { widgets: 'nope' } });
    expect(bad.status).toBe(400);
  });
});
