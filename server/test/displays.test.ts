import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DisplayDTO, DisplaysDTO, DisplayStatus } from '@hearthboard/shared';
import { timeStep, totpAt } from '../src/totp';
import { ADMIN, testApp, tmpDir } from './helpers';

type App = Awaited<ReturnType<typeof testApp>>;
type Client = ReturnType<App['client']>;
let app: App | null = null;
afterEach(async () => {
  await app?.app.close();
  app = null;
});

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const CODE = /^[A-HJ-NP-RT-Y3-46-9]{4}-[A-HJ-NP-RT-Y3-46-9]{4}$/;

/** A screen that shows a pairing code, like a TV that was just switched on. */
async function unpairedTv(a: App) {
  const tv = a.client();
  const res = await tv.inject('POST', '/api/displays/pair');
  expect(res.status).toBe(200);
  return { tv, code: res.body.code as string, res };
}

const me = async (c: Client) => (await c.inject('GET', '/api/displays/me')).body as DisplayStatus;

async function addMember(a: App, username = 'sam') {
  await a.inject('POST', '/api/users', { username, name: 'Sam', password: `${username}-password` });
  const c = a.client();
  await c.signIn(username, `${username}-password`);
  return c;
}

/** Every route a wall display reads. */
async function readRoutes(a: App) {
  const list = a.checklists.ensureDefault();
  return [
    '/api/boards/main',
    '/api/checklists',
    `/api/checklists/${list}`,
    '/api/calendars',
    '/api/events',
    '/api/reminders',
    '/api/reminders/lists',
    '/api/notes',
    '/api/meals',
    '/api/quotes/custom',
    '/api/quote',
    '/api/weather?lat=30&lon=-97',
    '/api/photos/next',
    '/api/photos/img/nothing',
  ];
}

describe('who can look at a board', () => {
  it('turns away screens that are not paired, on every route a display reads', async () => {
    app = await testApp();
    await app.login();
    const stranger = app.client();
    for (const url of await readRoutes(app)) {
      const res = await stranger.inject('GET', url);
      expect(res.status, url).toBe(401);
      expect(res.body, url).toEqual({ error: 'Pair this screen first.' });
      // ...while a signed-in person gets through (whatever the route then answers).
      expect((await app.inject('GET', url)).status, `${url} signed in`).not.toBe(401);
    }
  });

  it('lets a paired screen, and only that screen, in', async () => {
    app = await testApp();
    const tv = await app.display();
    const other = app.client();
    for (const url of await readRoutes(app)) {
      expect((await tv.inject('GET', url)).status, url).not.toBe(401);
      expect((await other.inject('GET', url)).status, `${url} unpaired`).toBe(401);
    }
    expect((await tv.inject('GET', '/api/boards/main')).status).toBe(200);
  });

  it('does not count a sign-in that is still waiting for its second step', async () => {
    app = await testApp();
    await app.login();
    const setup = await app.inject('POST', '/api/auth/totp/setup');
    await app.inject('POST', '/api/auth/totp/enable', {
      code: totpAt(setup.body.secret, timeStep()),
    });
    const half = app.client();
    expect((await half.signIn('admin', ADMIN.password)).body).toEqual({ stage: 'mfa' });
    expect((await half.inject('GET', '/api/boards/main')).status).toBe(401);
  });

  it('shows boards to any device when the household allows it, and only then', async () => {
    app = await testApp();
    await app.login();
    const stranger = app.client();
    expect(await me(stranger)).toMatchObject({ allowed: false, access: 'paired' });
    expect((await app.inject('GET', '/api/displays')).body.access).toBe('paired');

    expect((await app.inject('PUT', '/api/displays/access', { access: 'open' })).status).toBe(200);
    expect(await me(stranger)).toMatchObject({ allowed: true, access: 'open', name: null });
    for (const url of await readRoutes(app))
      expect((await stranger.inject('GET', url)).status, url).not.toBe(401);

    await app.inject('PUT', '/api/displays/access', { access: 'paired' });
    expect((await stranger.inject('GET', '/api/boards/main')).status).toBe(401);
  });

  it('keeps the public routes public', async () => {
    const webDir = tmpDir();
    fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hearthboard</title>');
    app = await testApp({ webDir });
    const stranger = app.client();
    expect((await stranger.inject('GET', '/api/health')).status).toBe(200);
    expect((await stranger.inject('GET', '/api/auth/status')).status).toBe(200);
    expect((await stranger.signIn('nobody', 'nothing')).body.error).toBe(
      'Wrong username or password.',
    );
    expect((await stranger.inject('GET', '/api/displays/me')).status).toBe(200);
    // The reminders Shortcut has its own token, and Google comes back to its own admin check.
    const ingest = await stranger.inject('POST', '/api/reminders/ingest', []);
    expect(ingest.body).toEqual({ error: 'Bad or missing token' });
    const google = await stranger.inject('GET', '/api/google/callback?state=x&code=y');
    expect(google.status).toBe(302);
    expect(google.raw.headers.location).toBe('/settings?google=login');
    // The web app itself, including the pairing page.
    for (const url of ['/', '/pair', '/settings'])
      expect((await stranger.inject('GET', url)).body, url).toContain('<title>Hearthboard');
  });
});

describe('the websocket', () => {
  const closed = (ws: { on: (e: 'close', cb: (code: number) => void) => void }) =>
    new Promise<number>((resolve) => ws.on('close', resolve));

  it('is refused to screens that are not paired', async () => {
    app = await testApp();
    await expect(app.app.injectWS('/ws')).rejects.toThrow(/401/);
    // A paired cookie for a screen that was since removed is no better.
    const tv = await app.display();
    const cookie = tv.cookieHeader();
    const admin = app.client();
    await admin.login();
    const [{ id }] = (await admin.inject('GET', '/api/displays')).body.displays as DisplayDTO[];
    await admin.inject('DELETE', `/api/displays/${id}`);
    await expect(app.app.injectWS('/ws', { headers: { cookie } })).rejects.toThrow(/401/);
  });

  it('is open to signed-in people and paired screens', async () => {
    app = await testApp();
    const tv = await app.display();
    const person = app.client();
    await person.login();
    const sockets = [
      await app.app.injectWS('/ws', { headers: { cookie: tv.cookieHeader() } }),
      await app.app.injectWS('/ws', { headers: { cookie: person.cookieHeader() } }),
    ];
    expect(app.live.size).toBe(2);
    const seen = new Promise<string>((resolve) =>
      sockets[0].on('message', (d: unknown) => resolve(String(d))),
    );
    app.live.publish('meals');
    expect(JSON.parse(await seen)).toEqual({ topic: 'meals' });
    for (const s of sockets) s.terminate();
  });

  it('is closed the moment its screen is removed', async () => {
    app = await testApp();
    const kitchen = await app.display('Kitchen');
    const hall = await app.display('Hall');
    const admin = app.client();
    await admin.login();
    const list = (await admin.inject('GET', '/api/displays')).body.displays as DisplayDTO[];
    const kitchenId = list.find((d) => d.name === 'Kitchen')!.id;

    const kitchenWs = await app.app.injectWS('/ws', {
      headers: { cookie: kitchen.cookieHeader() },
    });
    const hallWs = await app.app.injectWS('/ws', { headers: { cookie: hall.cookieHeader() } });
    const personWs = await app.app.injectWS('/ws', { headers: { cookie: admin.cookieHeader() } });
    const closedWith = closed(kitchenWs);
    await admin.inject('DELETE', `/api/displays/${kitchenId}`);
    expect(await closedWith).toBe(1008);
    expect(hallWs.readyState).toBe(1);
    expect(personWs.readyState).toBe(1);
    hallWs.terminate();
    personWs.terminate();
  });

  it('is closed for screens that only got in while access was open', async () => {
    app = await testApp();
    const tv = await app.display();
    const admin = app.client();
    await admin.login();
    await admin.inject('PUT', '/api/displays/access', { access: 'open' });
    const stranger = await app.app.injectWS('/ws');
    const paired = await app.app.injectWS('/ws', { headers: { cookie: tv.cookieHeader() } });
    const person = await app.app.injectWS('/ws', { headers: { cookie: admin.cookieHeader() } });

    const closedWith = closed(stranger);
    await admin.inject('PUT', '/api/displays/access', { access: 'paired' });
    expect(await closedWith).toBe(1008);
    expect(paired.readyState).toBe(1);
    expect(person.readyState).toBe(1);
    await expect(app.app.injectWS('/ws')).rejects.toThrow(/401/);
    paired.terminate();
    person.terminate();
  });
});

describe('pairing with a code', () => {
  it('shows a code on the screen, and the screen is in once an admin approves it', async () => {
    app = await testApp();
    const { tv, code, res } = await unpairedTv(app);
    expect(code).toMatch(CODE);
    expect(res.body.expiresAt).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(res.body.expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
    // The cookie is httpOnly, long-lived, and works like the session's.
    const cookie = String(res.raw.headers['set-cookie']);
    expect(cookie).toMatch(/^hb_display=[\w-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(Number(/Max-Age=(\d+)/.exec(cookie)![1])).toBeGreaterThanOrEqual(9 * 365 * 24 * 3600);

    // Waiting: it knows its code, but the cookie doesn't count yet.
    expect(await me(tv)).toEqual({
      allowed: false,
      access: 'paired',
      name: null,
      pending: { code, expiresAt: res.body.expiresAt },
    });
    expect((await tv.inject('GET', '/api/boards/main')).status).toBe(401);

    const admin = app.client();
    await admin.login();
    // Typed by hand: lower case, no dash, stray spaces.
    const typed = ` ${code.replace('-', '').toLowerCase()} `;
    const approved = await admin.inject('POST', '/api/displays/approve', {
      code: typed,
      name: ' Kitchen TV ',
    });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ name: 'Kitchen TV', waiting: false });

    expect(await me(tv)).toEqual({
      allowed: true,
      access: 'paired',
      name: 'Kitchen TV',
      pending: null,
    });
    expect((await tv.inject('GET', '/api/boards/main')).status).toBe(200);
    // The code is used up.
    const again = await admin.inject('POST', '/api/displays/approve', { code, name: 'Again' });
    expect(again.status).toBe(404);
  });

  it('keeps the same code when the screen reloads, and hands a paired screen no new one', async () => {
    app = await testApp();
    const { tv, code } = await unpairedTv(app);
    const again = await tv.inject('POST', '/api/displays/pair');
    expect(again.body.code).toBe(code);
    expect(again.raw.headers['set-cookie']).toBeUndefined();
    expect((app.db.prepare('SELECT COUNT(*) AS n FROM displays').get() as { n: number }).n).toBe(1);

    const admin = app.client();
    await admin.login();
    await admin.inject('POST', '/api/displays/approve', { code, name: 'Hall' });
    const paired = await tv.inject('POST', '/api/displays/pair');
    expect(paired.status).toBe(409);
  });

  it('runs out after 10 minutes and the screen asks for a fresh code', async () => {
    app = await testApp();
    const admin = app.client();
    await admin.login();
    const { tv, code } = await unpairedTv(app);
    app.db.prepare('UPDATE displays SET expires_at = ?').run(Date.now() - 1);

    expect((await me(tv)).pending).toBeNull();
    const approve = await admin.inject('POST', '/api/displays/approve', { code, name: 'Late' });
    expect(approve.status).toBe(404);
    expect(approve.body.error).toMatch(/isn't right, or it has run out/);
    // Expired codes are cleared out as new ones are asked for.
    const fresh = await tv.inject('POST', '/api/displays/pair');
    expect(fresh.status).toBe(200);
    expect((app.db.prepare('SELECT COUNT(*) AS n FROM displays').get() as { n: number }).n).toBe(1);
    expect(
      (
        await admin.inject('POST', '/api/displays/approve', {
          code: fresh.body.code,
          name: 'On time',
        })
      ).status,
    ).toBe(200);
  });

  it('only lets so many screens wait at once, and frees the room as codes run out', async () => {
    app = await testApp();
    const pair = (from: string) =>
      app!.app.inject({ method: 'POST', url: '/api/displays/pair', remoteAddress: from });
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) codes.add((await pair(`10.0.0.${i}`)).json().code);
    expect(codes.size).toBe(20);
    const full = await pair('10.0.0.99');
    expect(full.statusCode).toBe(429);
    expect(full.json().error).toMatch(/Too many screens/);

    app.db.prepare('UPDATE displays SET expires_at = ?').run(Date.now() - 1);
    expect((await app.client().inject('POST', '/api/displays/pair')).status).toBe(200);
    expect((app.db.prepare('SELECT COUNT(*) AS n FROM displays').get() as { n: number }).n).toBe(1);
  });

  it("doesn't let one device take every waiting place", async () => {
    app = await testApp();
    const pair = (from: string) =>
      app!.app.inject({ method: 'POST', url: '/api/displays/pair', remoteAddress: from });
    // No cookie kept, so each request is a "new screen": it only replaces its own codes.
    const codes: string[] = [];
    for (let i = 0; i < 50; i++) {
      const res = await pair('192.168.1.66');
      expect(res.statusCode).toBe(200);
      codes.push(res.json().code);
    }
    const waiting = app.db
      .prepare('SELECT COUNT(*) AS n FROM displays WHERE approved = 0')
      .get() as { n: number };
    expect(waiting.n).toBe(3);
    // Its latest code still works, and the kitchen TV can still get one.
    const approve = (code: string) =>
      app!.inject('POST', '/api/displays/approve', { code, name: 'TV' });
    await app.login();
    expect((await approve(codes[0])).status).toBe(404);
    expect((await approve(codes[49])).status).toBe(200);
    expect((await pair('192.168.1.20')).statusCode).toBe(200);
  });

  it('is for admins to approve', async () => {
    app = await testApp();
    await app.login();
    const sam = await addMember(app);
    const { code } = await unpairedTv(app);
    const body = { code, name: 'Sneaky' };
    expect((await app.client().inject('POST', '/api/displays/approve', body)).status).toBe(401);
    expect((await sam.inject('POST', '/api/displays/approve', body)).status).toBe(403);
    expect(
      (await app.inject('POST', '/api/displays/approve', { code: 'ZZZZ-ZZZZ', name: 'x' })).status,
    ).toBe(404);
    expect((await app.inject('POST', '/api/displays/approve', { code, name: '  ' })).status).toBe(
      400,
    );
    expect((await app.inject('POST', '/api/displays/approve', body)).status).toBe(200);
  });

  it('stores only a hash of the token, and a made-up cookie gets nowhere', async () => {
    app = await testApp();
    const { tv, code } = await unpairedTv(app);
    const admin = app.client();
    await admin.login();
    await admin.inject('POST', '/api/displays/approve', { code, name: 'TV' });
    const token = /hb_display=([^;]+)/.exec(tv.cookieHeader())![1];
    const row = app.db.prepare('SELECT * FROM displays').get() as Record<string, unknown>;
    expect(row.token_hash).toBe(sha256(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.code).toBeNull();

    const forged = app.client();
    for (const value of [
      'nope',
      token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'),
      sha256(token),
    ])
      expect(
        (
          await forged.inject('GET', '/api/boards/main', undefined, {
            cookie: `hb_display=${value}`,
          })
        ).status,
        value,
      ).toBe(401);
  });

  it('notes when a screen was last seen, at most once an hour', async () => {
    app = await testApp();
    const tv = await app.display();
    const admin = app.client();
    await admin.login();
    const seen = () => app!.db.prepare('SELECT last_seen FROM displays').pluck().get() as number;
    const hourAgo = Date.now() - 3600_000 - 60_000;

    app.db.prepare('UPDATE displays SET last_seen = ?').run(hourAgo);
    await tv.inject('GET', '/api/boards/main');
    expect(seen()).toBeGreaterThan(Date.now() - 5000);

    const recent = Date.now() - 30 * 60_000;
    app.db.prepare('UPDATE displays SET last_seen = ?').run(recent);
    await tv.inject('GET', '/api/boards/main');
    expect(seen()).toBe(recent);
  });
});

describe('pairing with a link', () => {
  it('makes a one-time link that sets the cookie and works only once', async () => {
    app = await testApp();
    const admin = app.client();
    await admin.login();
    const made = await admin.inject('POST', '/api/displays', { name: 'Pi in the hall' });
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({ name: 'Pi in the hall', waiting: true, lastSeen: null });
    // The secret rides in the #fragment, which is never sent to the server (or its log).
    const url = new URL(made.body.url);
    expect(url.origin + url.pathname).toBe('http://localhost/pair');
    expect(url.search).toBe('');
    const token = url.hash.replace('#token=', '');
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(made.body.expiresAt).toBeGreaterThan(Date.now() + 23 * 3600_000);

    // Not usable until it's opened.
    expect((await admin.inject('GET', '/api/displays')).body.displays[0]).toMatchObject({
      waiting: true,
    });
    const tv = app.client();
    const claimed = await tv.inject('POST', '/api/displays/claim', { token });
    expect(claimed.status).toBe(200);
    expect(String(claimed.raw.headers['set-cookie'])).toMatch(
      /^hb_display=.*HttpOnly.*SameSite=Lax/,
    );
    expect((await tv.inject('GET', '/api/boards/main')).status).toBe(200);
    expect(await me(tv)).toMatchObject({ allowed: true, name: 'Pi in the hall' });
    expect((await admin.inject('GET', '/api/displays')).body.displays[0]).toMatchObject({
      waiting: false,
      lastSeen: expect.any(Number),
    });

    // Used up: the link is worth nothing now, and nothing in the database holds it.
    expect((await app.client().inject('POST', '/api/displays/claim', { token })).status).toBe(404);
    const row = app.db.prepare('SELECT * FROM displays').get() as Record<string, unknown>;
    expect(row.claim_hash).toBeNull();
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.token_hash).not.toBe(sha256(token));
  });

  it('runs out after a day, and a made-up link gets nowhere', async () => {
    app = await testApp();
    const admin = app.client();
    await admin.login();
    const made = await admin.inject('POST', '/api/displays', { name: 'Old link' });
    const token = new URL(made.body.url).hash.replace('#token=', '');
    const claim = (t: string) => app!.client().inject('POST', '/api/displays/claim', { token: t });

    expect((await claim('nope')).status).toBe(404);
    expect((await claim(sha256(token))).status).toBe(404);
    app.db.prepare('UPDATE displays SET expires_at = ?').run(Date.now() - 1);
    const late = await claim(token);
    expect(late.status).toBe(404);
    expect(late.body.error).toMatch(/run out or was already used/);
    expect((await admin.inject('GET', '/api/displays')).body.displays).toEqual([]);
  });

  it('is for admins to make', async () => {
    app = await testApp();
    await app.login();
    const sam = await addMember(app);
    expect((await app.client().inject('POST', '/api/displays', { name: 'TV' })).status).toBe(401);
    expect((await sam.inject('POST', '/api/displays', { name: 'TV' })).status).toBe(403);
    expect((await app.inject('POST', '/api/displays', {})).status).toBe(400);
  });
});

describe('managing screens', () => {
  it('lists, renames and removes them, and a removed screen is out at once', async () => {
    app = await testApp();
    const kitchen = await app.display('Kitchen TV');
    await app.display('Hall');
    const admin = app.client();
    await admin.login();

    const listed = (await admin.inject('GET', '/api/displays')).body as DisplaysDTO;
    expect(listed.access).toBe('paired');
    expect(listed.displays.map((d) => d.name)).toEqual(['Kitchen TV', 'Hall']);
    const [first, second] = listed.displays;

    const renamed = await admin.inject('PATCH', `/api/displays/${first.id}`, { name: 'Kitchen' });
    expect(renamed.body).toMatchObject({ id: first.id, name: 'Kitchen' });
    expect((await me(kitchen)).name).toBe('Kitchen');
    expect((await admin.inject('PATCH', `/api/displays/${first.id}`, { name: '' })).status).toBe(
      400,
    );
    expect((await admin.inject('PATCH', '/api/displays/nope', { name: 'x' })).status).toBe(404);

    expect((await kitchen.inject('GET', '/api/boards/main')).status).toBe(200);
    expect((await admin.inject('DELETE', `/api/displays/${first.id}`)).status).toBe(200);
    expect((await kitchen.inject('GET', '/api/boards/main')).status).toBe(401);
    expect(await me(kitchen)).toMatchObject({ allowed: false, name: null, pending: null });
    expect((await admin.inject('DELETE', `/api/displays/${first.id}`)).status).toBe(404);
    expect(
      ((await admin.inject('GET', '/api/displays')).body.displays as DisplayDTO[]).map((d) => d.id),
    ).toEqual([second.id]);
  });

  it('is for admins, and only shows paired screens (not ones still waiting)', async () => {
    app = await testApp();
    await app.login();
    const sam = await addMember(app);
    await unpairedTv(app);
    const stranger = app.client();
    for (const [method, url, body] of [
      ['GET', '/api/displays', undefined],
      ['PUT', '/api/displays/access', { access: 'open' }],
      ['PATCH', '/api/displays/x', { name: 'x' }],
      ['DELETE', '/api/displays/x', undefined],
    ] as const) {
      expect((await stranger.inject(method, url, body)).status, `${method} ${url}`).toBe(401);
      expect((await sam.inject(method, url, body)).status, `${method} ${url}`).toBe(403);
    }
    expect((await app.inject('GET', '/api/displays')).body.displays).toEqual([]);
    expect((await app.inject('PUT', '/api/displays/access', { access: 'anyone' })).status).toBe(
      400,
    );
  });

  it('a signed-in person is not a display, and a display is not signed in', async () => {
    app = await testApp();
    const tv = await app.display();
    expect((await tv.inject('GET', '/api/auth/status')).body.authenticated).toBe(false);
    expect((await tv.inject('GET', '/api/boards')).status).toBe(401); // the editor's list
    expect((await tv.inject('GET', '/api/system')).status).toBe(401);
    expect((await tv.inject('GET', '/api/displays')).status).toBe(401);
    expect((await tv.inject('PUT', '/api/boards/main', {})).status).toBe(401);
  });

  it('survives a restart', async () => {
    app = await testApp();
    const tv = await app.display();
    const dataDir = app.config.dataDir;
    const cookie = tv.cookieHeader();
    await app.app.close();
    app = await testApp({ dataDir });
    expect((await app.inject('GET', '/api/boards/main', undefined, { cookie })).status).toBe(200);
  });
});

describe('touch-screen boards', () => {
  async function withInteractiveBoard() {
    app = await testApp();
    await app.login();
    const board = (await app.inject('GET', '/api/boards/main')).body;
    await app.inject('PUT', '/api/boards/main', { ...board, interactive: true });
    const list = board.widgets.find((w: { type: string }) => w.type === 'checklist').config
      .checklistId as string;
    const item = (await app.inject('GET', `/api/checklists/${list}`)).body.items[0];
    const tick = (c: Client) =>
      c.inject(
        'PATCH',
        `/api/checklists/${list}/items/${item.id}`,
        { done: true },
        {
          'x-hearthboard-board': 'main',
        },
      );
    return { board, tick };
  }

  it('need a paired screen as well as touch-screen mode', async () => {
    const { tick } = await withInteractiveBoard();
    const stranger = app!.client();
    expect((await tick(stranger)).status).toBe(401);
    expect((await tick(await app!.display())).status).toBe(200);
  });

  it('let any device tick when the household allows any device', async () => {
    const { tick } = await withInteractiveBoard();
    const stranger = app!.client();
    await app!.inject('PUT', '/api/displays/access', { access: 'open' });
    expect((await tick(stranger)).status).toBe(200);
    await app!.inject('PUT', '/api/displays/access', { access: 'paired' });
    expect((await tick(stranger)).status).toBe(401);
  });

  it('are refused for a removed screen, and for a paired screen on a board without touch mode', async () => {
    const { board, tick } = await withInteractiveBoard();
    const tv = await app!.display();
    expect((await tick(tv)).status).toBe(200);
    await app!.inject('PUT', '/api/boards/main', { ...board, interactive: false });
    expect((await tick(tv)).status).toBe(401);
    await app!.inject('PUT', '/api/boards/main', { ...board, interactive: true });
    expect((await tick(tv)).status).toBe(200);
    const [{ id }] = (await app!.inject('GET', '/api/displays')).body.displays as DisplayDTO[];
    await app!.inject('DELETE', `/api/displays/${id}`);
    expect((await tick(tv)).status).toBe(401);
  });

  it('let a paired screen complete reminders from its board, and nobody else', async () => {
    await withInteractiveBoard();
    app!.reminders.ingest({ reminders: [{ title: 'Milk', list: 'Groceries' }] });
    const [r] = (await app!.inject('GET', '/api/reminders')).body;
    const onMain = { 'x-hearthboard-board': 'main' };
    const stranger = app!.client();
    expect(
      (await stranger.inject('POST', `/api/reminders/${r.id}/complete`, {}, onMain)).status,
    ).toBe(401);
    const tv = await app!.display();
    expect((await tv.inject('POST', `/api/reminders/${r.id}/complete`, {}, onMain)).status).toBe(
      200,
    );
  });
});
