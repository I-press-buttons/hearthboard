import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { hostAllowed, hostName, parseAllowedHosts, publicHost } from '../src/hosts';
import { testApp } from './helpers';

type App = Awaited<ReturnType<typeof testApp>>;
let app: App | null = null;
afterEach(async () => {
  await app?.app.close();
  app = null;
});

const status = (a: App, host: string, headers: Record<string, string> = {}) =>
  a.inject('GET', '/api/health', undefined, { host, ...headers }).then((r) => r.status);

describe('host names', () => {
  it('reads the name out of a Host header', () => {
    expect(hostName('Board.Example.com')).toBe('board.example.com');
    expect(hostName('board.example.com:8080')).toBe('board.example.com');
    expect(hostName('192.168.1.20:8080')).toBe('192.168.1.20');
    expect(hostName('[::1]')).toBe('::1');
    expect(hostName('[fd00::1]:8080')).toBe('fd00::1');
    expect(hostName('diskstation.')).toBe('diskstation');
    // Things that aren't a host at all.
    for (const bad of ['', 'a b', 'host:port', 'host:80@evil.com', '[::1', '[nope]:80', 'a/b'])
      expect(hostName(bad), bad).toBeNull();
  });

  it('parses HEARTHBOARD_ALLOWED_HOSTS forgivingly', () => {
    expect(parseAllowedHosts(undefined)).toEqual([]);
    expect(
      parseAllowedHosts(' Board.Example.com , https://nas.example.org:8443/edit,*.Family.net, ,*'),
    ).toEqual(['board.example.com', 'nas.example.org', '*.family.net', '*']);
    expect(loadConfig({ HEARTHBOARD_ALLOWED_HOSTS: 'a.example.com' }).allowedHosts).toEqual([
      'a.example.com',
    ]);
    expect(loadConfig({}).allowedHosts).toEqual([]);
  });

  it('finds the host of the public address', () => {
    expect(publicHost('https://board.example.synology.me:5001/x')).toBe(
      'board.example.synology.me',
    );
    expect(publicHost('http://[::1]:8080')).toBe('::1');
    expect(publicHost(null)).toBeNull();
    expect(publicHost('not a url')).toBeNull();
  });

  it('allows the names of a home network and refuses the rest', () => {
    const ok = (h: string, allowed: string[] = [], pub: string | null = null) =>
      hostAllowed(h, allowed, () => pub);
    for (const good of [
      'localhost',
      'localhost:8080',
      '127.0.0.1:8080',
      '192.168.1.20',
      '8.8.8.8', // an address is an address: it can't be rebound
      '[::1]:8080',
      '[fd00::1]',
      'diskstation',
      'diskstation:8080',
      'nas.local',
      'nas.lan:8080',
      'hearth.home.arpa',
      'nas.internal',
      'nas.localdomain',
      'NAS.Local',
    ])
      expect(ok(good), good).toBe(true);
    for (const bad of [
      'evil.example.com',
      'evil.example.com:8080',
      '127.0.0.1.evil.com',
      'localhost.evil.com',
      'nas.local.evil.com',
      'nas.local.com',
      'evil.com.',
      'evil.com:80@localhost',
      '',
    ])
      expect(ok(bad), bad).toBe(false);

    expect(ok('board.example.com', ['board.example.com'])).toBe(true);
    expect(ok('other.example.com', ['board.example.com'])).toBe(false);
    // *.example.com is the domain itself and everything below it.
    for (const h of ['example.com', 'a.example.com', 'a.b.example.com:8080'])
      expect(ok(h, ['*.example.com']), h).toBe(true);
    for (const h of ['badexample.com', 'example.com.evil.com', 'example.org'])
      expect(ok(h, ['*.example.com']), h).toBe(false);
    expect(ok('board.example.synology.me', [], 'board.example.synology.me')).toBe(true);
    expect(ok('other.example.synology.me', [], 'board.example.synology.me')).toBe(false);
  });
});

describe('the host check', () => {
  it('lets the usual ways of opening a board through', async () => {
    app = await testApp();
    for (const host of [
      'localhost:8080',
      '192.168.1.20:8080',
      '[::1]:8080',
      'diskstation',
      'nas.local',
    ])
      expect(await status(app, host), host).toBe(200);
  });

  it('refuses other names with a note on what to do, and never gets as far as the data', async () => {
    app = await testApp();
    await app.login();
    const res = await app.inject('GET', '/api/boards/main', undefined, {
      host: 'attacker.example.com:8080',
    });
    expect(res.status).toBe(421);
    expect(res.raw.headers['content-type']).toMatch(/^text\/plain/);
    const text = String(res.body);
    expect(text).toContain('"attacker.example.com:8080"');
    expect(text).toContain('HEARTHBOARD_ALLOWED_HOSTS');
    expect(text).toMatch(/public address in Settings/);
    expect(text).toMatch(/IP address/);
    expect(text).not.toContain('widgets');
    // Even the health check and the web app's own pages.
    expect(await status(app, 'attacker.example.com')).toBe(421);
    expect((await app.inject('GET', '/', undefined, { host: 'attacker.example.com' })).status).toBe(
      421,
    );
  });

  it('goes by the Host header, not X-Forwarded-Host', async () => {
    app = await testApp();
    expect(await status(app, 'evil.example.com', { 'x-forwarded-host': 'localhost' })).toBe(421);
    expect(await status(app, 'localhost', { 'x-forwarded-host': 'evil.example.com' })).toBe(200);
  });

  it("answers to the public address from Settings as soon as it's saved", async () => {
    app = await testApp();
    const board = 'board.example.synology.me';
    expect(await status(app, board)).toBe(421);
    await app.login();
    await app.inject('PUT', '/api/system', { publicUrl: `https://${board}/` });
    expect(await status(app, board)).toBe(200);
    expect(await status(app, `${board}:5001`)).toBe(200);
    expect(await status(app, 'other.example.synology.me')).toBe(421);
    await app.inject('PUT', '/api/system', { publicUrl: '' });
    expect(await status(app, board)).toBe(421);
  });

  it('answers to the names in HEARTHBOARD_ALLOWED_HOSTS', async () => {
    app = await testApp({
      allowedHosts: loadConfig({
        HEARTHBOARD_ALLOWED_HOSTS: 'board.example.com,*.family.example.org',
      }).allowedHosts,
    });
    expect(await status(app, 'board.example.com')).toBe(200);
    expect(await status(app, 'tv.family.example.org')).toBe(200);
    expect(await status(app, 'family.example.org')).toBe(200);
    expect(await status(app, 'example.com')).toBe(421);
    expect(await status(app, 'evilfamily.example.org')).toBe(421);
  });

  it('is off with *', async () => {
    app = await testApp({ allowedHosts: ['*'] });
    expect(await status(app, 'anything.example.com')).toBe(200);
  });

  it('lets a request with no Host header through', async () => {
    app = await testApp();
    await app.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.app.server.address() as net.AddressInfo;
    // HTTP/1.0 doesn't have to send one.
    const reply = await new Promise<string>((resolve, reject) => {
      const sock = net.connect(port, '127.0.0.1', () =>
        sock.write('GET /api/health HTTP/1.0\r\n\r\n'),
      );
      let data = '';
      sock.on('data', (d) => (data += d));
      sock.on('end', () => resolve(data));
      sock.on('error', reject);
    });
    expect(reply).toMatch(/^HTTP\/1\.1 200 /);
  });
});
