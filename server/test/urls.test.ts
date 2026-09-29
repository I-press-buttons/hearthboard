import { afterEach, describe, expect, it } from 'vitest';
import { ICLOUD_CALDAV_URL } from '../src/calendars/caldav';
import { DemoProvider } from '../src/calendars/demo';
import { isHttpUrl } from '../src/util';
import { testApp } from './helpers';

type App = Awaited<ReturnType<typeof testApp>>;
let app: App | null = null;
afterEach(async () => {
  await app?.app.close();
  app = null;
});

describe('isHttpUrl', () => {
  it('accepts http and https addresses and nothing else', () => {
    expect(isHttpUrl('https://nas.local:5001')).toBe(true);
    expect(isHttpUrl('http://192.168.1.10:5000/')).toBe(true);
    for (const bad of ['ftp://nas/', 'file:///etc/passwd', 'javascript:alert(1)', 'nas.local', ''])
      expect(isHttpUrl(bad)).toBe(false);
  });
});

describe('server addresses in Settings', () => {
  const notHttp = ['ftp://nas.local/', 'file:///etc/passwd', 'javascript:alert(1)'];

  it('Synology Photos only takes http or https', async () => {
    app = await testApp();
    await app.login();
    for (const url of notHttp) {
      const res = await app.inject('POST', '/api/photos/synology', {
        url,
        username: 'wall',
        password: 'pw',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/starting with http:\/\/ or https:\/\//);
    }
    // A proper address gets as far as trying to connect (nothing is listening on port 1).
    const res = await app.inject('POST', '/api/photos/synology', {
      url: 'https://127.0.0.1:1',
      username: 'wall',
      password: 'pw',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).not.toMatch(/starting with http:\/\/ or https:\/\//);
  });

  it('CalDAV only takes http or https', async () => {
    app = await testApp();
    await app.login();
    for (const serverUrl of notHttp) {
      const res = await app.inject('POST', '/api/accounts/caldav', {
        preset: 'custom',
        serverUrl,
        username: 'sam',
        password: 'pw',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/starting with http:\/\/ or https:\/\//);
    }
  });

  it('adds iCloud with the address field left empty, as the dialog sends it', async () => {
    let connectedTo = '';
    app = await testApp(
      {},
      {
        providerFactory: (_kind, secret) => {
          connectedTo = (secret as { serverUrl: string }).serverUrl;
          return new DemoProvider();
        },
      },
    );
    await app.login();
    const form = { username: 'sam@icloud.com', password: 'abcd-efgh-ijkl-mnop', serverUrl: '' };
    const res = await app.inject('POST', '/api/accounts/caldav', { ...form, preset: 'icloud' });
    expect(res.status).toBe(200);
    expect(connectedTo).toBe(ICLOUD_CALDAV_URL);
    // A custom server does need one.
    const custom = await app.inject('POST', '/api/accounts/caldav', { ...form, preset: 'custom' });
    expect(custom).toMatchObject({ status: 400, body: { error: 'Enter the CalDAV server URL.' } });
  });
});
