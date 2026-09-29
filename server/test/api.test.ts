import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import type { CalendarDTO, EventDTO, LiveMessage } from '@hearthboard/shared';
import { DemoProvider } from '../src/calendars/demo';
import { buildApp } from '../src/app';
import { buildIcs } from '../src/calendars/ics';
import { loadConfig } from '../src/config';
import { MIGRATIONS } from '../src/db';
import { jpeg, testApp, testClient, tmpDir } from './helpers';

type App = Awaited<ReturnType<typeof testApp>>;
let app: App | null = null;
afterEach(async () => {
  await app?.app.close();
  app = null;
});

describe('general settings', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('are admin-only and fall back to the environment until saved', async () => {
    app = await testApp({ syncIntervalSec: 90, publicUrl: null });
    expect((await app.inject('GET', '/api/system')).status).toBe(401);
    await app.login();
    expect((await app.inject('GET', '/api/system')).body).toEqual({
      timeZone: originalTz,
      syncIntervalSec: 90,
      publicUrl: null,
    });
    await app.inject('POST', '/api/users', {
      username: 'sam',
      name: 'Sam',
      password: 'sam-password',
    });
    const sam = app.client();
    await sam.signIn('sam', 'sam-password');
    expect((await sam.inject('PUT', '/api/system', { syncIntervalSec: 120 })).status).toBe(403);
  });

  it('saves time zone, sync interval and public address, and they survive a restart', async () => {
    app = await testApp();
    await app.login();
    const res = await app.inject('PUT', '/api/system', {
      timeZone: 'Europe/London',
      syncIntervalSec: 300,
      publicUrl: 'https://board.example.synology.me/',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      timeZone: 'Europe/London',
      syncIntervalSec: 300,
      publicUrl: 'https://board.example.synology.me',
    });
    expect(process.env.TZ).toBe('Europe/London');

    // Google sign-in now redirects to the saved address.
    const start = await app.inject('POST', '/api/accounts/google/start', {
      clientId: 'client-id-1234',
      clientSecret: 'secret',
    });
    expect(start.body.redirectUri).toBe('https://board.example.synology.me/api/google/callback');

    // Clearing the address goes back to copy-and-paste sign-in.
    expect((await app.inject('PUT', '/api/system', { publicUrl: '' })).body.publicUrl).toBeNull();

    // Saved values beat the environment on the next start.
    const dataDir = app.config.dataDir;
    await app.app.close();
    app = await testApp({ dataDir, timeZone: 'Asia/Tokyo', syncIntervalSec: 60 });
    await app.login();
    expect((await app.inject('GET', '/api/system')).body).toMatchObject({
      timeZone: 'Europe/London',
      syncIntervalSec: 300,
      publicUrl: null,
    });
  });

  it('rejects bad values', async () => {
    app = await testApp();
    await app.login();
    expect((await app.inject('PUT', '/api/system', { timeZone: 'Mars/Olympus' })).status).toBe(400);
    expect((await app.inject('PUT', '/api/system', { syncIntervalSec: 5 })).status).toBe(400);
    expect((await app.inject('PUT', '/api/system', { publicUrl: 'not a url' })).status).toBe(400);
  });
});

describe('boards', () => {
  it('creates a default board and broadcasts saved layouts', async () => {
    app = await testApp();
    await app.login();
    const board = (await app.inject('GET', '/api/boards/main')).body;
    expect(board.widgets.map((w: { type: string }) => w.type).sort()).toEqual([
      'calendar',
      'checklist',
      'clock',
      'photo',
      'quote',
      'reminders',
    ]);
    const seen: LiveMessage[] = [];
    app.live.subscribe((m) => seen.push(m));
    board.widgets[0].x = 3;
    const res = await app.inject('PUT', '/api/boards/main', board);
    expect(res.status).toBe(200);
    expect((await app.inject('GET', '/api/boards/main')).body.widgets[0].x).toBe(3);
    expect(seen).toContainEqual({ topic: 'board', id: 'main' });
  });

  it('rejects invalid layouts', async () => {
    app = await testApp();
    await app.login();
    const res = await app.inject('PUT', '/api/boards/main', {
      name: 'x',
      widgets: [{ id: 'a', type: 'nope', x: 0, y: 0, w: 1, h: 1 }],
    });
    expect(res.status).toBe(400);
  });
});

describe('checklists', () => {
  it('adds, ticks and resets daily lists', async () => {
    app = await testApp();
    await app.login();
    const list = (await app.inject('POST', '/api/checklists', { name: 'Chores', resetDaily: true }))
      .body;
    let cur = (await app.inject('POST', `/api/checklists/${list.id}/items`, { text: 'Dishes' }))
      .body;
    const item = cur.items[0];
    cur = (await app.inject('PATCH', `/api/checklists/${list.id}/items/${item.id}`, { done: true }))
      .body;
    expect(cur.items[0].done).toBe(true);

    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(app.checklists.resetIfNewDay(tomorrow)).toBe(true);
    expect(app.checklists.get(list.id)!.items[0].done).toBe(false);
  });
});

describe('request hardening', () => {
  it('refuses changes posted from other sites, but not from the app or a Shortcut', async () => {
    app = await testApp();
    await app.login();
    const post = (site?: string) =>
      app!.inject(
        'POST',
        '/api/checklists',
        { name: 'Groceries' },
        site ? { 'sec-fetch-site': site } : {},
      );
    expect((await post('cross-site')).status).toBe(403);
    expect((await post('same-site')).status).toBe(403); // e.g. another app on the NAS
    expect((await post('same-origin')).status).toBe(200);
    expect((await post()).status).toBe(200); // older browsers, iPhone Shortcuts
    // Reading is fine from anywhere (a display in an iframe, a link).
    const read = await app.inject('GET', '/api/checklists', undefined, {
      'sec-fetch-site': 'cross-site',
    });
    expect(read.status).toBe(200);
    expect(read.raw.headers['x-content-type-options']).toBe('nosniff');
    expect(read.raw.headers['referrer-policy']).toBe('same-origin');
  });

  it("sends a strict CSP, and lets other sites frame the app only when they're listed", async () => {
    app = await testApp();
    let res = (await app.inject('GET', '/api/health')).raw;
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self' ws://localhost:80 wss://localhost:80");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    await app.app.close();

    app = await testApp({ embedOrigins: ['http://homeassistant.local:8123'] });
    res = (await app.inject('GET', '/api/health')).raw;
    expect(res.headers['content-security-policy']).toContain(
      'frame-ancestors http://homeassistant.local:8123',
    );
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('reads HEARTHBOARD_EMBED_ORIGINS and refuses anything else', () => {
    const env = (v: string) => loadConfig({ HEARTHBOARD_EMBED_ORIGINS: v }).embedOrigins;
    expect(loadConfig({}).embedOrigins).toEqual([]);
    expect(env('http://homeassistant.local:8123/, https://ha.example.com')).toEqual([
      'http://homeassistant.local:8123',
      'https://ha.example.com',
    ]);
    expect(() => env("'unsafe-inline'")).toThrow(/HEARTHBOARD_EMBED_ORIGINS/);
    expect(() => env('http://x.local; script-src *')).toThrow(/HEARTHBOARD_EMBED_ORIGINS/);
  });

  it('keeps internal error details from people who are not signed in', async () => {
    const dataDir = tmpDir();
    const ctx = await buildApp({ ...loadConfig({}), dataDir }, { background: false });
    ctx.app.get('/api/test-boom', async () => {
      throw new Error('SQLITE_CORRUPT at /data/hearthboard.db');
    });
    ctx.app.get('/api/test-boom-signed-in', { preHandler: ctx.auth.guard }, async () => {
      throw new Error('Upstream said no');
    });
    await ctx.app.ready();
    app = { ...ctx, ...testClient(ctx.app) } as unknown as App;
    const out = await app.inject('GET', '/api/test-boom');
    expect(out).toMatchObject({ status: 502, body: { error: 'Something went wrong' } });
    await app.login();
    expect((await app.inject('GET', '/api/test-boom-signed-in')).body.error).toBe(
      'Upstream said no',
    );
  });
});

describe('reminders ingest', () => {
  it('requires the token and accepts loose Shortcuts payloads', async () => {
    app = await testApp();
    await app.login();
    const token = app.auth.ingestToken();
    expect((await app.inject('POST', '/api/reminders/ingest', [])).status).toBe(401);
    expect(
      (await app.inject('POST', '/api/reminders/ingest', [], { authorization: 'Bearer nope' }))
        .status,
    ).toBe(401);
    // A token with multi-byte characters is simply wrong, not a server error.
    const accented = { authorization: `Bearer ${'é'.repeat(token.length)}` };
    expect((await app.inject('POST', '/api/reminders/ingest', [], accented)).status).toBe(401);
    // Only in the header: a token in the URL would end up in the request log.
    expect((await app.inject('POST', `/api/reminders/ingest?token=${token}`, [])).status).toBe(401);

    const res = await app.inject(
      'POST',
      '/api/reminders/ingest',
      [
        { title: 'Call plumber', list: 'Home', due: '2026-10-01T15:00:00-05:00', flagged: 'Yes' },
        { title: '  Buy milk ', list: 'Groceries', due: '', priority: '' },
        { title: '', list: 'Broken' },
      ],
      { authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: 2, skipped: 1, complete: [] });
    const list = (await app.inject('GET', '/api/reminders')).body;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      title: 'Call plumber',
      flagged: true,
      due: '2026-10-01T20:00:00.000Z',
    });
    expect(list[1]).toMatchObject({ title: 'Buy milk', due: null });
    expect((await app.inject('GET', '/api/reminders?lists=Home')).body).toHaveLength(1);
  });

  it('hands board ticks back to the Shortcut until the phone reports them done', async () => {
    app = await testApp();
    await app.login();
    const auth = { authorization: `Bearer ${app.auth.ingestToken()}` };
    const payload = {
      reminders: [
        { title: 'Sign form', list: 'Family', created: '2026-09-01' },
        { title: 'Walk dog', list: 'Home' },
      ],
    };
    await app.inject('POST', '/api/reminders/ingest', payload, auth);
    const [first] = (await app.inject('GET', '/api/reminders')).body;

    expect(
      (await app.inject('POST', `/api/reminders/${first.id}/complete`, { done: true })).status,
    ).toBe(200);
    expect((await app.inject('GET', '/api/reminders')).body[0].pendingComplete).toBe(true);

    // Phone still lists it as open: keep asking.
    let res = await app.inject('POST', '/api/reminders/ingest', payload, auth);
    expect(res.body.complete).toEqual([
      { title: 'Sign form', list: 'Family', created: '2026-09-01' },
    ]);

    // Phone completed it: the request is done.
    res = await app.inject(
      'POST',
      '/api/reminders/ingest',
      { reminders: [payload.reminders[1]] },
      auth,
    );
    expect(res.body.complete).toEqual([]);
    expect(
      (await app.inject('GET', '/api/reminders')).body.map((r: { title: string }) => r.title),
    ).toEqual(['Walk dog']);
  });
});

describe('quotes', () => {
  it('returns the same entry for the whole day and alternates in "both" mode', async () => {
    app = await testApp();
    const a = app.quotes.current('verse', 'daily', new Date(2026, 9, 1, 8));
    const b = app.quotes.current('verse', 'daily', new Date(2026, 9, 1, 22));
    expect(a).toEqual(b);
    expect(a.source).toMatch(/\(ESV\)$/);
    const kinds = [1, 2].map(
      (d) => app!.quotes.current('both', 'daily', new Date(2026, 9, d, 12)).kind,
    );
    expect(new Set(kinds)).toEqual(new Set(['verse', 'quote']));
  });

  it('uses custom entries, falling back to verses when there are none', async () => {
    app = await testApp();
    expect(app.quotes.current('custom', 'daily').kind).toBe('verse');
    await app.login();
    await app.inject('POST', '/api/quotes/custom', { text: 'Be kind.', source: 'Mom' });
    expect((await app.inject('GET', '/api/quote?mode=custom')).body).toEqual({
      kind: 'custom',
      text: 'Be kind.',
      source: 'Mom',
    });
  });
});

describe('photos (folder source)', () => {
  it('skips Synology metadata folders and serves HEIC via the @eaDir preview', async () => {
    app = await testApp();
    await app.login();
    const root = app.config.photosDir;
    await jpeg(path.join(root, 'Trips', 'beach.jpg'), 800, 600);
    await jpeg(path.join(root, '@eaDir', 'junk.jpg'));
    await jpeg(path.join(root, '#recycle', 'old.jpg'));
    fs.writeFileSync(path.join(root, 'Trips', 'IMG_0001.HEIC'), 'not really heic');
    await jpeg(
      path.join(root, 'Trips', '@eaDir', 'IMG_0001.HEIC', 'SYNOPHOTO_THUMB_XL.jpg'),
      1280,
      960,
      '#123456',
    );

    expect((await app.photos.folder.list()).sort()).toEqual([
      'Trips/IMG_0001.HEIC',
      'Trips/beach.jpg',
    ]);

    const ids = new Set<string>();
    for (let i = 0; i < 2; i++) ids.add((await app.inject('GET', '/api/photos/next')).body.id);
    expect(ids.size).toBe(2); // shuffled deck: no repeats before everything was shown

    for (const id of ids) {
      const res = await app.inject('GET', `/api/photos/img/${id}?w=300&h=300`);
      expect(res.status).toBe(200);
      expect(res.raw.headers['content-type']).toBe('image/jpeg');
      const meta = await sharp(res.raw.rawPayload).metadata();
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(512);
    }
  });

  it('refuses paths outside the photo folder', async () => {
    app = await testApp();
    await app.login();
    const id = 'f.' + Buffer.from(JSON.stringify('../hearthboard.db')).toString('base64url');
    expect((await app.inject('GET', `/api/photos/img/${id}`)).status).toBe(404);
  });

  it('only serves photos it handed out, and never hidden or non-image files', async () => {
    app = await testApp();
    await app.login();
    const root = app.config.photosDir;
    await jpeg(path.join(root, 'beach.jpg'));
    await jpeg(path.join(root, '#recycle', 'deleted.jpg'));
    await jpeg(path.join(root, '.private', 'secret.jpg'));
    fs.writeFileSync(path.join(root, 'notes.txt'), 'not a photo');
    fs.symlinkSync(path.join(app.config.dataDir, 'hearthboard.db'), path.join(root, 'db.jpg'));

    const forged = (rel: string) => 'f.' + Buffer.from(JSON.stringify(rel)).toString('base64url');
    expect((await app.inject('GET', `/api/photos/img/${forged('beach.jpg')}`)).status).toBe(404);
    for (const rel of ['#recycle/deleted.jpg', '.private/secret.jpg', 'notes.txt', 'db.jpg']) {
      expect(await app.photos.folder.readable(rel), rel).toBeNull();
    }
    expect(await app.photos.folder.readable('./x/../beach.jpg')).toBe(path.join(root, 'beach.jpg'));

    // Hidden folders can't be picked, and every spelling of a folder shares one scan.
    for (const folder of ['#recycle', '.private', '../', 'x/../#recycle']) {
      const res = await app.inject('GET', `/api/photos/next?folder=${encodeURIComponent(folder)}`);
      expect(res.body.id, folder).toBeNull();
    }
    expect(app.photos.folder.folderKey('./a/../')).toBe('');

    // Deep folders make long ids; they still have to reach the image route.
    const deep =
      'Holidays/2026-07 Summer at the lake with the grandparents/IMG_20260712_153045_HDR.jpg';
    await jpeg(path.join(root, deep));
    const next = await app.inject(
      'GET',
      `/api/photos/next?folder=${encodeURIComponent(path.dirname(deep))}`,
    );
    expect(next.body.id.length).toBeGreaterThan(100);
    expect((await app.inject('GET', `/api/photos/img/${next.body.id}`)).status).toBe(200);
  });
});

describe('calendar write-back', () => {
  async function withDemo() {
    const provider = DemoProvider.seeded(new Date(2026, 9, 5, 12));
    app = await testApp({}, { providerFactory: () => provider });
    await app.login();
    await app.calendars.addAccount('demo', 'Family', null);
    await app.calendars.syncAll();
    const cals = (await app.inject('GET', '/api/calendars')).body;
    return { provider, cal: cals[0] };
  }

  const week = '/api/events?start=2026-10-01T00:00:00Z&end=2026-10-15T00:00:00Z';

  it('creates, moves and deletes events on the provider', async () => {
    const { provider, cal } = await withDemo();
    const created = await app!.inject('POST', '/api/events', {
      calendarId: cal.id,
      title: 'Piano recital',
      start: '2026-10-09T23:00:00Z',
      end: '2026-10-10T00:00:00Z',
    });
    expect(created.status).toBe(200);
    let ev = (await app!.inject('GET', week)).body.find(
      (e: { title: string }) => e.title === 'Piano recital',
    );
    expect(ev).toMatchObject({
      start: '2026-10-09T23:00:00.000Z',
      calendarId: cal.id,
      editable: true,
    });

    const moved = await app!.inject('PATCH', `/api/events/${ev.resourceId}`, {
      start: '2026-10-10T15:00:00Z',
      end: '2026-10-10T16:30:00Z',
    });
    expect(moved.status).toBe(200);
    ev = (await app!.inject('GET', week)).body.find(
      (e: { title: string }) => e.title === 'Piano recital',
    );
    expect(ev).toMatchObject({
      start: '2026-10-10T15:00:00.000Z',
      end: '2026-10-10T16:30:00.000Z',
    });
    expect(provider.writes.map((w) => w.op)).toEqual(['create', 'update']);

    await app!.inject('DELETE', `/api/events/${ev.resourceId}`, {});
    expect(
      (await app!.inject('GET', week)).body.some(
        (e: { title: string }) => e.title === 'Piano recital',
      ),
    ).toBe(false);
  });

  it('removes a single occurrence of a repeating event', async () => {
    await withDemo();
    const trash = (await app!.inject('GET', week)).body.filter(
      (e: { title: string }) => e.title === 'Trash night',
    );
    expect(trash.length).toBe(2);
    const res = await app!.inject('DELETE', `/api/events/${trash[0].resourceId}`, {
      recurrenceId: trash[0].recurrenceId,
      scope: 'instance',
    });
    expect(res.status).toBe(200);
    const after = (await app!.inject('GET', week)).body.filter(
      (e: { title: string }) => e.title === 'Trash night',
    );
    expect(after.map((e: { start: string }) => e.start)).toEqual([trash[1].start]);
  });

  it('answers 409 and refreshes when the event changed elsewhere', async () => {
    const { provider } = await withDemo();
    const ev = (await app!.inject('GET', week)).body.find(
      (e: { title: string }) => e.title === 'Grocery run',
    );
    // Someone edits it on their phone: the server copy gets a new etag.
    for (const [calRemoteId, store] of provider.store) {
      for (const [href, r] of store) {
        if (r.payload.includes('Grocery run')) {
          provider.put(calRemoteId, r.payload.replace('Grocery run', 'Costco run'), href);
        }
      }
    }
    const res = await app!.inject('PATCH', `/api/events/${ev.resourceId}`, { title: 'Groceries' });
    expect(res.status).toBe(409);
    const titles = (await app!.inject('GET', week)).body.map((e: { title: string }) => e.title);
    expect(titles).toContain('Costco run');
  });

  it('refuses writes to read-only calendars', async () => {
    const provider = new DemoProvider([
      { remoteId: '/ro/', name: 'Holidays', color: null, writable: false },
    ]);
    app = await testApp({}, { providerFactory: () => provider });
    await app.login();
    await app.calendars.addAccount('demo', 'Holidays', null);
    const [cal] = (await app.inject('GET', '/api/calendars')).body;
    const res = await app.inject('POST', '/api/events', {
      calendarId: cal.id,
      title: 'x',
      start: '2026-10-01',
      end: '2026-10-02',
      allDay: true,
    });
    expect(res.status).toBe(403);
  });
});

describe('who can change events', () => {
  const week = '/api/events?start=2026-10-01T00:00:00Z&end=2026-10-15T00:00:00Z';
  const REFUSED = 'Only an admin can change events on this calendar.';

  /** Two writable calendars (Family, Work) and a read-only one (Holidays), each with an event. */
  async function withPeople() {
    const provider = new DemoProvider([
      { remoteId: '/family/', name: 'Family', color: null, writable: true },
      { remoteId: '/work/', name: 'Work', color: null, writable: true },
      { remoteId: '/holidays/', name: 'Holidays', color: null, writable: false },
    ]);
    const ics = (title: string) =>
      buildIcs(
        { title, start: '2026-10-09T17:00:00Z', end: '2026-10-09T18:00:00Z', allDay: false },
        `${title}@test`,
      );
    provider.put('/family/', ics('Family dinner'));
    provider.put('/work/', ics('Board meeting'));
    provider.put('/holidays/', ics('Public holiday'));
    // A repeating event, to try "only this one" and "all events".
    provider.put(
      '/family/',
      ics('Trash night').replace('END:VEVENT', 'RRULE:FREQ=WEEKLY\r\nEND:VEVENT'),
    );
    app = await testApp({}, { providerFactory: () => provider });
    await app.login();
    await app.calendars.addAccount('demo', 'Household', null);
    await app.calendars.syncAll();

    for (const [username, role] of [
      ['sam', 'member'],
      ['robin', 'admin'],
    ])
      await app.inject('POST', '/api/users', {
        username,
        name: username,
        password: `${username}-password`,
        role,
      });
    const sam = app.client();
    await sam.signIn('sam', 'sam-password');
    const robin = app.client();
    await robin.signIn('robin', 'robin-password');
    const display = await app.display(); // a wall display: paired, never signed in

    const cals = (await app.inject('GET', '/api/calendars')).body as CalendarDTO[];
    const cal = (name: string) => cals.find((c) => c.name === name)!;
    const events = (await app.inject('GET', week)).body as EventDTO[];
    const event = (title: string) => events.find((e) => e.title === title)!;
    return { provider, sam, robin, display, cal, event };
  }

  const newEvent = (calendarId: string) => ({
    calendarId,
    title: 'Movie night',
    start: '2026-10-10T23:00:00Z',
    end: '2026-10-11T01:00:00Z',
  });

  it('is off for every calendar until an admin turns it on', async () => {
    const { cal } = await withPeople();
    expect(cal('Family')).toMatchObject({ writable: true, membersCanEdit: false });
    expect(cal('Work')).toMatchObject({ writable: true, membersCanEdit: false });
  });

  it('keeps existing calendars off when upgrading', async () => {
    const dataDir = tmpDir();
    const db = new Database(path.join(dataDir, 'hearthboard.db'));
    // The database as it was before this setting existed.
    const added = MIGRATIONS.findIndex((m) => String(m).includes('members_can_edit'));
    MIGRATIONS.slice(0, added).forEach((step, i) => {
      if (typeof step === 'string') db.exec(step);
      else step(db);
      db.pragma(`user_version = ${i + 1}`);
    });
    db.prepare("INSERT INTO accounts (id, provider, name) VALUES ('a', 'demo', 'Mom')").run();
    db.prepare(
      "INSERT INTO calendars (id, account_id, remote_id, name, writable) VALUES ('c', 'a', '/mom/', 'Personal', 1)",
    ).run();
    db.close();

    app = await testApp({ dataDir });
    await app.login();
    expect((await app.inject('GET', '/api/calendars')).body).toEqual([
      expect.objectContaining({ name: 'Personal', writable: true, membersCanEdit: false }),
    ]);
  });

  it('refuses a member on a calendar the family cannot edit', async () => {
    const { provider, sam, cal, event } = await withPeople();
    const created = await sam.inject('POST', '/api/events', newEvent(cal('Family').id));
    expect(created.status).toBe(403);
    expect(created.body.error).toBe(REFUSED);

    const dinner = event('Family dinner');
    const moved = await sam.inject('PATCH', `/api/events/${dinner.resourceId}`, {
      start: '2026-10-09T20:00:00Z',
      end: '2026-10-09T21:00:00Z',
    });
    expect(moved.status).toBe(403);
    expect(moved.body.error).toBe(REFUSED);
    expect((await sam.inject('DELETE', `/api/events/${dinner.resourceId}`, {})).status).toBe(403);

    // Repeating events: neither "only this one" nor "all events".
    const trash = event('Trash night');
    for (const scope of ['instance', 'series']) {
      const body = { recurrenceId: trash.recurrenceId, scope };
      const edit = await sam.inject('PATCH', `/api/events/${trash.resourceId}`, {
        ...body,
        title: 'x',
      });
      expect(edit.status).toBe(403);
      const del = await sam.inject('DELETE', `/api/events/${trash.resourceId}`, body);
      expect(del.status).toBe(403);
    }
    expect(provider.writes).toEqual([]);
  });

  it('lets a member change only the calendars an admin opened to the family', async () => {
    const { provider, sam, cal, event } = await withPeople();
    const patch = await app!.inject('PATCH', `/api/calendars/${cal('Family').id}`, {
      membersCanEdit: true,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.find((c: CalendarDTO) => c.name === 'Family').membersCanEdit).toBe(true);

    expect((await sam.inject('POST', '/api/events', newEvent(cal('Family').id))).status).toBe(200);
    const dinner = event('Family dinner');
    const moved = await sam.inject('PATCH', `/api/events/${dinner.resourceId}`, {
      title: 'Late dinner',
      start: '2026-10-09T20:00:00Z',
      end: '2026-10-09T21:00:00Z',
    });
    expect(moved.status).toBe(200);
    const trash = event('Trash night');
    const series = await sam.inject('PATCH', `/api/events/${trash.resourceId}`, {
      scope: 'series',
      title: 'Bins out',
    });
    expect(series.status).toBe(200);
    const one = await sam.inject('DELETE', `/api/events/${trash.resourceId}`, {
      recurrenceId: trash.recurrenceId,
      scope: 'instance',
    });
    expect(one.status).toBe(200);
    expect((await sam.inject('DELETE', `/api/events/${dinner.resourceId}`, {})).status).toBe(200);
    expect(provider.writes.map((w) => w.op)).toEqual([
      'create',
      'update',
      'update',
      'delete',
      'delete',
    ]);

    // Work is still closed, and an event is judged by the calendar it lives in.
    expect((await sam.inject('POST', '/api/events', newEvent(cal('Work').id))).status).toBe(403);
    const meeting = event('Board meeting');
    const edit = await sam.inject('PATCH', `/api/events/${meeting.resourceId}`, { title: 'x' });
    expect(edit.status).toBe(403);
    expect((await sam.inject('DELETE', `/api/events/${meeting.resourceId}`, {})).status).toBe(403);

    // Turned off again, the family loses access straight away.
    await app!.inject('PATCH', `/api/calendars/${cal('Family').id}`, { membersCanEdit: false });
    expect((await sam.inject('POST', '/api/events', newEvent(cal('Family').id))).status).toBe(403);
  });

  it('never lets anyone change a read-only calendar', async () => {
    const { sam, robin, cal, event } = await withPeople();
    const holidays = cal('Holidays');
    // There is nothing to open up on a calendar nobody can change.
    const patch = await app!.inject('PATCH', `/api/calendars/${holidays.id}`, {
      membersCanEdit: true,
    });
    expect(patch.status).toBe(400);
    const holiday = event('Public holiday');
    for (const who of [app!, robin, sam]) {
      expect((await who.inject('POST', '/api/events', newEvent(holidays.id))).status).toBe(403);
      expect((await who.inject('DELETE', `/api/events/${holiday.resourceId}`, {})).status).toBe(
        403,
      );
    }
  });

  it('always lets an admin change any writable calendar', async () => {
    const { provider, robin, cal, event } = await withPeople();
    // Both admins, on calendars the family cannot edit.
    const meeting = event('Board meeting');
    for (const admin of [app!, robin]) {
      const created = await admin.inject('POST', '/api/events', newEvent(cal('Work').id));
      expect(created.status).toBe(200);
      const edit = await admin.inject('PATCH', `/api/events/${meeting.resourceId}`, {
        title: 'Moved',
      });
      expect(edit.status).toBe(200);
    }
    const dinner = event('Family dinner');
    expect((await robin.inject('DELETE', `/api/events/${dinner.resourceId}`, {})).status).toBe(200);
    expect(provider.writes.map((w) => w.op)).toEqual([
      'create',
      'update',
      'create',
      'update',
      'delete',
    ]);
  });

  it('needs sign-in to change events at all', async () => {
    const { display, cal, event } = await withPeople();
    const dinner = event('Family dinner');
    expect((await display.inject('POST', '/api/events', newEvent(cal('Family').id))).status).toBe(
      401,
    );
    expect((await display.inject('DELETE', `/api/events/${dinner.resourceId}`, {})).status).toBe(
      401,
    );
  });

  it('lets only admins change the setting', async () => {
    const { sam, robin, display, cal } = await withPeople();
    const url = `/api/calendars/${cal('Family').id}`;
    const flag = async () =>
      ((await app!.inject('GET', '/api/calendars')).body as CalendarDTO[]).find(
        (c) => c.name === 'Family',
      )!.membersCanEdit;

    expect((await sam.inject('PATCH', url, { membersCanEdit: true })).status).toBe(403);
    expect((await display.inject('PATCH', url, { membersCanEdit: true })).status).toBe(401);
    expect(await flag()).toBe(false);

    const asAdmin = await robin.inject('PATCH', url, { membersCanEdit: true });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.find((c: CalendarDTO) => c.name === 'Family').membersCanEdit).toBe(true);
    expect(await flag()).toBe(true);

    // A member can't switch it back off either.
    expect((await sam.inject('PATCH', url, { membersCanEdit: false })).status).toBe(403);
    expect(await flag()).toBe(true);
  });

  it('tells each viewer what they may edit', async () => {
    const { sam, robin, display, cal } = await withPeople();
    await app!.inject('PATCH', `/api/calendars/${cal('Family').id}`, { membersCanEdit: true });

    const seenBy = async (who: typeof sam) => {
      const cals = (await who.inject('GET', '/api/calendars')).body as CalendarDTO[];
      const evts = (await who.inject('GET', week)).body as EventDTO[];
      return {
        calendars: Object.fromEntries(cals.map((c) => [c.name, c.editable])),
        events: Object.fromEntries(evts.map((e) => [e.title, e.editable])),
      };
    };
    const all = (editable: boolean) => ({
      // Read-only calendars stay read-only for everyone.
      calendars: { Family: editable, Work: editable, Holidays: false },
      events: {
        'Family dinner': editable,
        'Trash night': editable,
        'Board meeting': editable,
        'Public holiday': false,
      },
    });

    expect(await seenBy(robin)).toEqual(all(true));
    expect(await seenBy(app!)).toEqual(all(true));
    // A member: only the calendar opened to the family.
    expect(await seenBy(sam)).toEqual({
      calendars: { Family: true, Work: false, Holidays: false },
      events: {
        'Family dinner': true,
        'Trash night': true,
        'Board meeting': false,
        'Public holiday': false,
      },
    });
    // A display that isn't signed in can look but not change.
    expect(await seenBy(display)).toEqual(all(false));
    // The setting itself is visible to all, so Settings shows the right state.
    const seen = (await display.inject('GET', '/api/calendars')).body as CalendarDTO[];
    expect(seen.map((c) => [c.name, c.membersCanEdit])).toEqual([
      ['Family', true],
      ['Work', false],
      ['Holidays', false],
    ]);
  });
});
