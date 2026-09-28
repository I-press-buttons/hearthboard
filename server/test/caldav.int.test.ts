/**
 * Runs the CalDAV provider (the code path used for iCloud) against a real
 * Radicale server. Skipped when Radicale isn't installed (`pip install radicale`).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CalDavProvider } from '../src/calendars/caldav';
import { ConflictError } from '../src/calendars/provider';
import { testApp, tmpDir } from './helpers';

const hasRadicale = spawnSync('python3', ['-c', 'import radicale']).status === 0;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(port: number) {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/.web/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('Radicale did not start');
}

describe.skipIf(!hasRadicale)('CalDAV against Radicale', () => {
  let proc: ChildProcess;
  let url: string;
  let storage: string;

  beforeAll(async () => {
    storage = tmpDir('hb-radicale-');
    const cal = path.join(storage, 'collection-root', 'mom', 'family');
    fs.mkdirSync(cal, { recursive: true });
    fs.writeFileSync(
      path.join(cal, '.Radicale.props'),
      JSON.stringify({
        tag: 'VCALENDAR',
        'D:displayname': 'Family',
        'ICAL:calendar-color': '#ff9500ff',
        'C:supported-calendar-component-set': 'VEVENT',
      }),
    );
    const port = await freePort();
    url = `http://127.0.0.1:${port}/`;
    proc = spawn('python3', [
      '-m',
      'radicale',
      '--server-hosts',
      `127.0.0.1:${port}`,
      '--storage-filesystem-folder',
      storage,
      '--auth-type',
      'none',
      '--logging-level',
      'warning',
    ]);
    await waitFor(port);
  });

  afterAll(() => {
    proc?.kill();
  });

  it('lists calendars, writes with ETags, and detects conflicts', async () => {
    const p = new CalDavProvider({ serverUrl: url, username: 'mom', password: 'x' });
    const cals = await p.listCalendars();
    expect(cals).toHaveLength(1);
    expect(cals[0]).toMatchObject({ name: 'Family', color: '#ff9500' });
    const ref = { remoteId: cals[0].remoteId, cursor: null };
    const win = { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2027-01-01T00:00:00Z') };

    const created = await p.create(ref, {
      title: 'Dentist',
      start: '2026-10-20T15:00:00Z',
      end: '2026-10-20T16:00:00Z',
      allDay: false,
    });
    expect(created.etag).toBeTruthy();
    expect(created.payload).toContain('SUMMARY:Dentist');

    const first = await p.sync(ref, win);
    expect(first.full).toBe(true);
    expect(first.upserts).toHaveLength(1);
    expect(first.cursor).toBeTruthy();
    expect(await p.sync({ ...ref, cursor: first.cursor }, win)).toMatchObject({ unchanged: true });

    const updated = await p.update(ref, created, {
      scope: 'instance',
      title: 'Dentist (moved)',
      start: '2026-10-21T15:00:00Z',
    });
    expect(updated).not.toBeNull();
    expect((updated as { etag: string }).etag).not.toBe(created.etag);
    expect((await p.sync({ ...ref, cursor: first.cursor }, win)).unchanged).toBeFalsy();

    // Writing with the old ETag must fail rather than overwrite the newer copy.
    await expect(
      p.update(ref, created, { scope: 'instance', title: 'stale' }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await p.remove(ref, updated as typeof created, { scope: 'instance' })).toBeNull();
    expect((await p.sync(ref, win)).upserts).toHaveLength(0);
  });

  it('syncs through the whole app: API writes land on the server', async () => {
    const app = await testApp();
    try {
      await app.login();
      const acct = await app.inject('POST', '/api/accounts/caldav', {
        preset: 'custom',
        name: 'Radicale',
        serverUrl: url,
        username: 'mom',
        password: 'x',
      });
      expect(acct.status).toBe(200);
      await app.calendars.syncAll();
      const [cal] = (await app.inject('GET', '/api/calendars')).body;
      const res = await app.inject('POST', '/api/events', {
        calendarId: cal.id,
        title: 'Soccer',
        start: '2026-10-24',
        end: '2026-10-25',
        allDay: true,
      });
      expect(res.status).toBe(200);
      const files = fs
        .readdirSync(path.join(storage, 'collection-root', 'mom', 'family'))
        .filter((f) => f.endsWith('.ics'));
      const onDisk = files.map((f) =>
        fs.readFileSync(path.join(storage, 'collection-root', 'mom', 'family', f), 'utf8'),
      );
      expect(
        onDisk.some(
          (s) => s.includes('SUMMARY:Soccer') && s.includes('DTSTART;VALUE=DATE:20261024'),
        ),
      ).toBe(true);

      const events = (
        await app.inject('GET', '/api/events?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z')
      ).body;
      expect(events.find((e: { title: string }) => e.title === 'Soccer')).toMatchObject({
        allDay: true,
        start: '2026-10-24',
      });
    } finally {
      await app.app.close();
    }
  });
});
