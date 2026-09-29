import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/db';
import { timeStep, totpAt } from '../src/totp';
import { ADMIN, testApp, tmpDir } from './helpers';

type App = Awaited<ReturnType<typeof testApp>>;
type Client = ReturnType<App['client']>;
let app: App | null = null;
afterEach(async () => {
  await app?.app.close();
  app = null;
});

const code = (secret: string, offsetSteps = 0) => totpAt(secret, timeStep() + offsetSteps);

/** Turn on two-step sign-in for whoever `c` is signed in as. */
async function enableMfa(c: Client) {
  const setup = await c.inject('POST', '/api/auth/totp/setup');
  expect(setup.status).toBe(200);
  expect(setup.body.qrSvg).toContain('<svg');
  const enabled = await c.inject('POST', '/api/auth/totp/enable', {
    code: code(setup.body.secret),
  });
  expect(enabled.status).toBe(200);
  expect(enabled.body.recoveryCodes).toHaveLength(10);
  return {
    secret: setup.body.secret as string,
    recoveryCodes: enabled.body.recoveryCodes as string[],
  };
}

async function addUser(admin: Client, username: string, role: 'admin' | 'member' = 'member') {
  const res = await admin.inject('POST', '/api/users', {
    username,
    name: username[0].toUpperCase() + username.slice(1),
    password: `${username}-password`,
    role,
  });
  expect(res.status).toBe(200);
  return res.body as { id: string; username: string };
}

describe('sign-in', () => {
  it('creates the first admin once, then signs in by username and password', async () => {
    app = await testApp();
    expect((await app.inject('GET', '/api/auth/status')).body).toMatchObject({
      setupNeeded: true,
      authenticated: false,
    });
    expect((await app.inject('PUT', '/api/boards/main', {})).status).toBe(401);

    expect(
      (await app.inject('POST', '/api/auth/setup', { ...ADMIN, password: 'short' })).status,
    ).toBe(400);
    expect((await app.inject('POST', '/api/auth/setup', ADMIN)).status).toBe(200);
    const status = (await app.inject('GET', '/api/auth/status')).body;
    expect(status).toMatchObject({ setupNeeded: false, authenticated: true });
    expect(status.user).toMatchObject({ username: 'admin', role: 'admin', mfa: false });
    // Setup is a one-time thing.
    expect(
      (await app.client().inject('POST', '/api/auth/setup', { ...ADMIN, username: 'eve' })).status,
    ).toBe(409);

    app.logout();
    expect((await app.signIn('admin', 'wrong password')).status).toBe(401);
    expect((await app.signIn('nobody', ADMIN.password)).status).toBe(401);
    const ok = await app.signIn('ADMIN', ADMIN.password); // usernames ignore case
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ stage: 'full' });
    expect(ok.raw.headers['set-cookie']).toMatch(/HttpOnly/);
    expect((await app.inject('GET', '/api/auth/status')).body.authenticated).toBe(true);

    await app.inject('POST', '/api/auth/logout');
    expect((await app.inject('GET', '/api/auth/status')).body.authenticated).toBe(false);
  });

  it('locks out after repeated wrong passwords', async () => {
    app = await testApp({ adminPassword: 'from the environment' });
    for (let i = 0; i < 5; i++) await app.signIn('admin', 'nope');
    expect((await app.signIn('admin', 'from the environment')).status).toBe(429);
  });

  it("doesn't let a made-up X-Forwarded-For header dodge the lockout", async () => {
    app = await testApp({ adminPassword: 'from the environment' });
    for (let i = 0; i < 5; i++) {
      await app.inject(
        'POST',
        '/api/auth/login',
        { username: 'admin', password: 'nope' },
        { 'x-forwarded-for': `10.0.0.${i}` },
      );
    }
    const res = await app.inject(
      'POST',
      '/api/auth/login',
      { username: 'admin', password: 'from the environment' },
      { 'x-forwarded-for': '10.0.0.99' },
    );
    expect(res.status).toBe(429);
  });

  it("doesn't forget wrong guesses at one account when you sign in to another", async () => {
    app = await testApp();
    await app.login();
    await addUser(app, 'sam');
    const sam = app.client();
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 2; i++) await sam.signIn('admin', 'guess');
      expect((await sam.signIn('sam', 'sam-password')).status).toBe(200);
    }
    expect((await sam.signIn('admin', ADMIN.password)).status).toBe(429);
    // Sam's own sign-in isn't held up by the guesses at the admin's.
    expect((await sam.signIn('sam', 'sam-password')).status).toBe(200);
  });

  it('counts wrong passwords when turning off two-step sign-in or making recovery codes', async () => {
    app = await testApp();
    await app.login();
    await enableMfa(app);
    for (let i = 0; i < 3; i++)
      await app.inject('POST', '/api/auth/totp/disable', { password: 'nope' });
    for (let i = 0; i < 2; i++)
      await app.inject('POST', '/api/auth/recovery-codes', { password: 'nope' });
    expect(
      (await app.inject('POST', '/api/auth/totp/disable', { password: ADMIN.password })).status,
    ).toBe(429);
  });

  it('changing your password signs out your other devices', async () => {
    app = await testApp();
    await app.login();
    const phone = app.client();
    await phone.login();
    expect(
      (
        await app.inject('POST', '/api/auth/password', {
          current: 'nope',
          password: 'new password',
        })
      ).status,
    ).toBe(400);
    const res = await app.inject('POST', '/api/auth/password', {
      current: ADMIN.password,
      password: 'new password',
    });
    expect(res.status).toBe(200);
    expect((await app.inject('GET', '/api/auth/status')).body.authenticated).toBe(true);
    expect((await phone.inject('GET', '/api/auth/status')).body.authenticated).toBe(false);
    expect((await phone.signIn('admin', 'new password')).status).toBe(200);
  });
});

describe('two-step sign-in', () => {
  it('asks for an authenticator code after the password', async () => {
    app = await testApp();
    await app.login();
    const { secret } = await enableMfa(app);
    expect((await app.inject('GET', '/api/auth/status')).body.user.mfa).toBe(true);

    const c = app.client();
    expect((await c.signIn('admin', ADMIN.password)).body).toEqual({ stage: 'mfa' });
    // Half signed in: nothing works yet.
    expect((await c.inject('GET', '/api/auth/status')).body).toMatchObject({
      authenticated: false,
      stage: 'mfa',
      user: null,
    });
    expect((await c.inject('GET', '/api/boards')).status).toBe(401);
    expect((await c.inject('POST', '/api/auth/totp/setup')).status).toBe(401);

    expect((await c.inject('POST', '/api/auth/mfa', { code: '000000' })).status).toBe(401);
    const next = code(secret, 1);
    const res = await c.inject('POST', '/api/auth/mfa', { code: next });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'full', usedRecoveryCode: false });
    expect((await c.inject('GET', '/api/auth/status')).body.authenticated).toBe(true);
    expect((await c.inject('GET', '/api/boards')).status).toBe(200);

    // Each code works once, even inside its 30 seconds.
    const again = app.client();
    await again.signIn('admin', ADMIN.password);
    expect((await again.inject('POST', '/api/auth/mfa', { code: next })).status).toBe(401);
  });

  it('accepts each recovery code once', async () => {
    app = await testApp();
    await app.login();
    const { recoveryCodes } = await enableMfa(app);
    const c = app.client();
    await c.signIn('admin', ADMIN.password);
    // Codes are forgiving about case, spaces and the dash.
    const typed = ` ${recoveryCodes[0].toUpperCase().replace('-', ' ')} `;
    const res = await c.inject('POST', '/api/auth/mfa', { code: typed });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ usedRecoveryCode: true, recoveryCodesLeft: 9 });

    const d = app.client();
    await d.signIn('admin', ADMIN.password);
    expect((await d.inject('POST', '/api/auth/mfa', { code: recoveryCodes[0] })).status).toBe(401);
  });

  it("doesn't let signing in again with the password reset the count of wrong codes", async () => {
    app = await testApp();
    await app.login();
    await enableMfa(app);
    const thief = app.client();
    for (let round = 0; round < 3; round++) {
      expect((await thief.signIn('admin', ADMIN.password)).body).toEqual({ stage: 'mfa' });
      for (let i = 0; i < 2; i++) await thief.inject('POST', '/api/auth/mfa', { code: '000000' });
    }
    await thief.signIn('admin', ADMIN.password);
    expect((await thief.inject('POST', '/api/auth/mfa', { code: '000000' })).status).toBe(429);
  });

  it('makes you start over after too many wrong codes', async () => {
    app = await testApp();
    await app.login();
    const { secret } = await enableMfa(app);
    const c = app.client();
    await c.signIn('admin', ADMIN.password);
    for (let i = 0; i < 4; i++) await c.inject('POST', '/api/auth/mfa', { code: '000000' });
    const last = await c.inject('POST', '/api/auth/mfa', { code: '000000' });
    expect(last.body.error).toMatch(/start again/i);
    // The half-done sign-in is gone: the password has to be entered again.
    expect((await c.inject('GET', '/api/auth/status')).body.stage).toBeNull();
    const res = await c.inject('POST', '/api/auth/mfa', { code: code(secret, 1) });
    expect(res.status).not.toBe(200);
  });

  it('only turns on once a code from the app proves it was set up', async () => {
    app = await testApp();
    await app.login();
    await app.inject('POST', '/api/auth/totp/setup');
    expect((await app.inject('POST', '/api/auth/totp/enable', { code: '123456' })).status).toBe(
      400,
    );
    expect((await app.inject('GET', '/api/auth/status')).body.user.mfa).toBe(false);
    // Signing in still only needs the password.
    expect((await app.client().signIn('admin', ADMIN.password)).body.stage).toBe('full');
  });

  it('needs the password to turn off or to make new recovery codes', async () => {
    app = await testApp();
    await app.login();
    await enableMfa(app);
    expect(
      (await app.inject('POST', '/api/auth/recovery-codes', { password: 'nope' })).status,
    ).toBe(400);
    const fresh = await app.inject('POST', '/api/auth/recovery-codes', {
      password: ADMIN.password,
    });
    expect(fresh.body.recoveryCodes).toHaveLength(10);
    expect((await app.inject('POST', '/api/auth/totp/setup')).status).toBe(409);

    expect((await app.inject('POST', '/api/auth/totp/disable', { password: 'nope' })).status).toBe(
      400,
    );
    expect(
      (await app.inject('POST', '/api/auth/totp/disable', { password: ADMIN.password })).status,
    ).toBe(200);
    expect((await app.client().signIn('admin', ADMIN.password)).body.stage).toBe('full');
  });

  it('can be required for everyone: sign-in then sets it up before letting you in', async () => {
    app = await testApp();
    await app.login();
    await addUser(app, 'sam');
    const kitchenTablet = app.client();
    await kitchenTablet.signIn('sam', 'sam-password');
    // The admin has to use it first.
    expect((await app.inject('PUT', '/api/auth/policy', { requireMfa: true })).status).toBe(400);
    await enableMfa(app);
    expect((await app.inject('PUT', '/api/auth/policy', { requireMfa: true })).status).toBe(200);
    // Takes effect at once: Sam, signed in with just a password, is signed out.
    expect((await kitchenTablet.inject('GET', '/api/auth/status')).body.authenticated).toBe(false);
    expect((await app.inject('GET', '/api/auth/status')).body.authenticated).toBe(true);

    const sam = app.client();
    expect((await sam.signIn('sam', 'sam-password')).body).toEqual({ stage: 'enroll' });
    expect((await sam.inject('GET', '/api/auth/status')).body).toMatchObject({
      authenticated: false,
      stage: 'enroll',
      requireMfa: true,
    });
    expect((await sam.inject('GET', '/api/boards')).status).toBe(401);
    const setup = await sam.inject('POST', '/api/auth/totp/setup');
    expect(setup.status).toBe(200);
    const enabled = await sam.inject('POST', '/api/auth/totp/enable', {
      code: code(setup.body.secret),
    });
    expect(enabled.status).toBe(200);
    expect((await sam.inject('GET', '/api/auth/status')).body.authenticated).toBe(true);
    expect((await sam.inject('GET', '/api/boards')).status).toBe(200);

    // Turning it off while it's required keeps this device, but every other one has to sign
    // in (and set it up) again.
    const samPhone = app.client();
    await samPhone.signIn('sam', 'sam-password');
    await samPhone.inject('POST', '/api/auth/mfa', { code: code(setup.body.secret, 1) });
    expect((await samPhone.inject('GET', '/api/auth/status')).body.authenticated).toBe(true);
    expect(
      (await sam.inject('POST', '/api/auth/totp/disable', { password: 'sam-password' })).status,
    ).toBe(200);
    expect((await sam.inject('GET', '/api/auth/status')).body.authenticated).toBe(true);
    expect((await samPhone.inject('GET', '/api/auth/status')).body.authenticated).toBe(false);

    // Members can't change the rule.
    expect((await sam.inject('PUT', '/api/auth/policy', { requireMfa: false })).status).toBe(403);
  });

  it('turning it on signs out your other devices', async () => {
    app = await testApp();
    await app.login();
    const tablet = app.client();
    await tablet.login();
    await enableMfa(app);
    expect((await app.inject('GET', '/api/auth/status')).body.authenticated).toBe(true);
    expect((await tablet.inject('GET', '/api/auth/status')).body.authenticated).toBe(false);
  });
});

describe('people', () => {
  it('lets admins add, change and remove people', async () => {
    app = await testApp();
    await app.login();
    const sam = await addUser(app, 'sam');
    expect(
      (
        await app.inject('POST', '/api/users', {
          username: 'SAM',
          name: 'Another Sam',
          password: 'whatever123',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await app.inject('POST', '/api/users', {
          username: 'x y',
          name: 'X',
          password: 'whatever1',
        })
      ).status,
    ).toBe(400);
    const list = (await app.inject('GET', '/api/users')).body;
    expect(list.map((u: { username: string }) => u.username)).toEqual(['admin', 'sam']);
    expect(list[1]).not.toHaveProperty('password');

    const samClient = app.client();
    expect((await samClient.signIn('sam', 'sam-password')).status).toBe(200);
    expect((await samClient.inject('GET', '/api/auth/status')).body.user).toMatchObject({
      name: 'Sam',
      role: 'member',
    });

    // A new password from the admin signs Sam out.
    await app.inject('PATCH', `/api/users/${sam.id}`, { password: 'new-sam-password' });
    expect((await samClient.inject('GET', '/api/auth/status')).body.authenticated).toBe(false);
    expect((await samClient.signIn('sam', 'new-sam-password')).status).toBe(200);

    await app.inject('PATCH', `/api/users/${sam.id}`, { name: 'Samantha', role: 'admin' });
    expect((await samClient.inject('GET', '/api/users')).status).toBe(200);

    expect((await app.inject('DELETE', `/api/users/${sam.id}`)).status).toBe(200);
    expect((await samClient.inject('GET', '/api/auth/status')).body.authenticated).toBe(false);
    expect((await samClient.signIn('sam', 'new-sam-password')).status).toBe(401);
  });

  it('keeps at least one admin', async () => {
    app = await testApp();
    await app.login();
    const me = (await app.inject('GET', '/api/auth/status')).body.user;
    expect((await app.inject('PATCH', `/api/users/${me.id}`, { role: 'member' })).status).toBe(400);
    expect((await app.inject('DELETE', `/api/users/${me.id}`)).status).toBe(400);
  });

  it('resets a lost authenticator', async () => {
    app = await testApp();
    await app.login();
    const sam = await addUser(app, 'sam');
    const samClient = app.client();
    await samClient.signIn('sam', 'sam-password');
    await enableMfa(samClient);
    expect((await app.client().signIn('sam', 'sam-password')).body.stage).toBe('mfa');

    const res = await app.inject('PATCH', `/api/users/${sam.id}`, { resetMfa: true });
    expect(res.body).toMatchObject({ mfa: false, recoveryCodesLeft: 0 });
    expect((await app.client().signIn('sam', 'sam-password')).body.stage).toBe('full');
  });

  it('keeps household settings to admins', async () => {
    app = await testApp();
    await app.login();
    await addUser(app, 'sam');
    const sam = app.client();
    await sam.signIn('sam', 'sam-password');
    for (const [method, url] of [
      ['GET', '/api/users'],
      ['POST', '/api/users'],
      ['GET', '/api/accounts'],
      ['POST', '/api/accounts/caldav'],
      ['POST', '/api/sync'],
      ['GET', '/api/reminders/setup'],
      ['POST', '/api/reminders/token'],
      ['POST', '/api/photos/synology'],
    ]) {
      expect((await sam.inject(method, url, {})).status, `${method} ${url}`).toBe(403);
    }
    // ...but everyday things are open to everyone signed in.
    const list = (await sam.inject('POST', '/api/checklists', { name: 'Sam chores' })).body;
    expect(list.name).toBe('Sam chores');
    expect((await sam.inject('POST', '/api/quotes/custom', { text: 'Hi' })).status).toBe(200);
  });
});

describe('boards per person', () => {
  it('gives each new person their own board, which only they (and admins) can change', async () => {
    app = await testApp();
    await app.login();
    const sam = await addUser(app, 'sam');
    const samClient = app.client();
    await samClient.signIn('sam', 'sam-password');

    const samBoards = (await samClient.inject('GET', '/api/boards')).body;
    expect(samBoards).toEqual([
      { id: expect.any(String), name: 'Sam', ownerId: sam.id, ownerName: 'Sam' },
    ]);
    const samBoard = (await samClient.inject('GET', `/api/boards/${samBoards[0].id}`)).body;
    expect(samBoard.widgets.length).toBeGreaterThan(0);

    // Admins see everyone's.
    const all = (await app.inject('GET', '/api/boards')).body;
    expect(all.map((b: { ownerName: string }) => b.ownerName)).toEqual(['Admin', 'Sam']);

    // Sam can't touch the admin's board, but the display still shows it to anyone.
    const main = (await app.inject('GET', '/api/boards/main')).body;
    expect((await samClient.inject('PUT', '/api/boards/main', main)).status).toBe(403);
    expect((await samClient.inject('DELETE', '/api/boards/main')).status).toBe(403);
    expect((await app.client().inject('GET', '/api/boards/main')).status).toBe(200);
    expect((await samClient.inject('PUT', '/api/boards/nope', main)).status).toBe(404);

    // Sam's own board is Sam's to change; so is the admin's to help with.
    samBoard.name = 'Sam room';
    expect((await samClient.inject('PUT', `/api/boards/${samBoard.id}`, samBoard)).status).toBe(
      200,
    );
    samBoard.name = 'Sam bedroom';
    expect((await app.inject('PUT', `/api/boards/${samBoard.id}`, samBoard)).status).toBe(200);

    // New boards belong to whoever made them.
    const extra = (
      await samClient.inject('POST', '/api/boards', { name: 'Desk', copyFrom: 'main' })
    ).body;
    expect((await samClient.inject('GET', '/api/boards')).body).toHaveLength(2);
    for (const bad of [{ copyFrom: {} }, { name: 123 }, { name: 'x'.repeat(101) }]) {
      expect((await samClient.inject('POST', '/api/boards', bad)).status).toBe(400);
    }
    expect((await app.inject('GET', `/api/boards/${extra.id}`)).body.widgets).toEqual(main.widgets);
    expect((await samClient.inject('DELETE', `/api/boards/${extra.id}`)).status).toBe(200);
    expect((await samClient.inject('DELETE', `/api/boards/${samBoard.id}`)).status).toBe(400);
  });

  it('lets admins hand a board to someone, and takes back boards of removed people', async () => {
    app = await testApp();
    await app.login();
    const sam = await addUser(app, 'sam');
    const kitchen = (await app.inject('POST', '/api/boards', { name: 'Kitchen' })).body;

    const samClient = app.client();
    await samClient.signIn('sam', 'sam-password');
    expect(
      (await samClient.inject('PUT', `/api/boards/${kitchen.id}/owner`, { ownerId: sam.id }))
        .status,
    ).toBe(403);
    expect(
      (await app.inject('PUT', `/api/boards/${kitchen.id}/owner`, { ownerId: sam.id })).status,
    ).toBe(200);
    expect(
      (await samClient.inject('GET', '/api/boards')).body.map((b: { name: string }) => b.name),
    ).toEqual(['Sam', 'Kitchen']);

    await app.inject('DELETE', `/api/users/${sam.id}`);
    const all = (await app.inject('GET', '/api/boards')).body;
    expect(all.map((b: { name: string; ownerName: string }) => [b.name, b.ownerName])).toEqual([
      ['Home', 'Admin'],
      ['Sam', 'Admin'],
      ['Kitchen', 'Admin'],
    ]);
  });
});

describe('upgrading and recovery', () => {
  it('turns the old admin PIN into an "admin" user who owns every board', async () => {
    const dataDir = tmpDir();
    const db = new Database(path.join(dataDir, 'hearthboard.db'));
    db.exec(MIGRATIONS[0] as string);
    db.pragma('user_version = 1');
    const salt = crypto.randomBytes(16).toString('base64url');
    const hash = crypto.scryptSync('2468', salt, 32).toString('base64url');
    db.prepare("INSERT INTO settings (key, value) VALUES ('adminPin', ?)").run(
      JSON.stringify({ salt, hash }),
    );
    db.prepare('INSERT INTO sessions (token, created_at, last_seen) VALUES (?, 1, 1)').run('old');
    db.prepare("INSERT INTO boards (id, data, updated_at) VALUES ('main', ?, 1)").run(
      JSON.stringify({ id: 'main', name: 'Kitchen', widgets: [] }),
    );
    db.close();

    app = await testApp({ dataDir });
    const status = (await app.inject('GET', '/api/auth/status')).body;
    expect(status).toMatchObject({ setupNeeded: false, legacyPin: true, authenticated: false });
    expect((await app.signIn('admin', '2468')).status).toBe(200);
    expect((await app.inject('GET', '/api/boards')).body).toEqual([
      { id: 'main', name: 'Kitchen', ownerId: expect.any(String), ownerName: 'Admin' },
    ]);
    await app.inject('POST', '/api/auth/password', {
      current: '2468',
      password: 'a real password',
    });
    expect((await app.inject('GET', '/api/auth/status')).body.legacyPin).toBe(false);
  });

  it('creates the admin from HEARTHBOARD_ADMIN_PASSWORD, owning the first board', async () => {
    app = await testApp({ adminPassword: 'from the environment' });
    expect((await app.inject('GET', '/api/auth/status')).body.setupNeeded).toBe(false);
    expect((await app.signIn('admin', 'from the environment')).status).toBe(200);
    expect((await app.inject('GET', '/api/boards')).body[0]).toMatchObject({
      id: 'main',
      ownerName: 'Admin',
    });
  });

  it('uses the environment password only to create the admin, so changes survive restarts', async () => {
    app = await testApp({ adminPassword: 'from the environment' });
    await app.signIn('admin', 'from the environment');
    await app.inject('POST', '/api/auth/password', {
      current: 'from the environment',
      password: 'changed in settings',
    });
    const dataDir = app.config.dataDir;
    await app.app.close();

    app = await testApp({ dataDir, adminPassword: 'from the environment' });
    expect((await app.signIn('admin', 'from the environment')).status).toBe(401);
    expect((await app.signIn('admin', 'changed in settings')).status).toBe(200);
  });

  it('HEARTHBOARD_RESET_ADMIN gets a locked-out admin back in', async () => {
    const dataDir = tmpDir();
    app = await testApp({ dataDir });
    await app.login();
    await enableMfa(app);
    await app.inject('POST', '/api/auth/password', {
      current: ADMIN.password,
      password: 'forgotten password',
    });
    await app.app.close();

    app = await testApp({ dataDir, adminPassword: 'back in again', resetAdmin: true });
    const res = await app.signIn('admin', 'back in again');
    expect(res.body).toEqual({ stage: 'full' });
    expect((await app.inject('GET', '/api/auth/status')).body.user).toMatchObject({
      role: 'admin',
      mfa: false,
    });
  });
});
