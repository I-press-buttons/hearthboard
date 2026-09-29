import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountDTO } from '@hearthboard/shared';
import {
  AuthError,
  type CalendarProvider,
  type RemoteResource,
  type SyncResult,
} from '../src/calendars/provider';
import { CalendarService } from '../src/calendars/service';
import { SecretBox } from '../src/secrets';
import { testApp } from './helpers';

type App = Awaited<ReturnType<typeof testApp>>;
let app: App | null = null;

const START = Date.parse('2026-10-05T12:00:00Z');
const SECOND = 1000;
const HOUR = 3_600_000;

beforeEach(() => {
  // Only the clock is fake, so the database and the app keep running normally.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
});

afterEach(async () => {
  vi.useRealTimers();
  await app?.app.close();
  app = null;
});

/** One calendar that syncs fine until told to fail. */
class ScriptedProvider implements CalendarProvider {
  syncs = 0;
  failWith: Error | null = null;

  async listCalendars() {
    return [{ remoteId: '/family/', name: 'Family', color: null, writable: false }];
  }

  async sync(): Promise<SyncResult> {
    this.syncs++;
    if (this.failWith) throw this.failWith;
    return { full: true, upserts: [], deletes: [], cursor: 'c1' };
  }

  async create(): Promise<RemoteResource> {
    throw new Error('read-only');
  }

  async update(): Promise<never> {
    throw new Error('read-only');
  }

  async remove(): Promise<never> {
    throw new Error('read-only');
  }
}

/** An app with a 30 s sync interval and one syncing account for each name. */
async function withAccounts(...names: string[]) {
  const providers = new Map<string, ScriptedProvider>();
  const factory = (_kind: string, secret: unknown) =>
    providers.get((secret as { name: string }).name)!;
  app = await testApp({}, { providerFactory: factory });
  await app.login();
  app.calendars.reschedule(30);
  const ids: string[] = [];
  for (const name of names) {
    providers.set(name, new ScriptedProvider());
    const account = await app.calendars.addAccount('demo', name, { name });
    await app.calendars.syncAccount(account.id); // waits for the sync addAccount started
    ids.push(account.id);
  }
  const account = (id: string) => app!.calendars.listAccounts().find((a) => a.id === id)!;
  return { providers, ids, account, factory };
}

describe('backing off from a failing account', () => {
  it('waits twice as long after each failure, up to six hours', async () => {
    const { providers, ids, account } = await withAccounts('Feed');
    const [id] = ids;
    const feed = providers.get('Feed')!;
    feed.failWith = new Error('Server error 500');

    const waits = [30, 60, 120, 240, 480, 960, 1920, 3840, 7680, 15360, 21600, 21600, 21600];
    for (const seconds of waits) {
      await app!.calendars.syncAccount(id);
      expect(account(id)).toMatchObject({
        status: 'error',
        lastError: 'Server error 500',
        paused: false,
        nextRetryAt: Date.now() + seconds * SECOND,
      });
      // The timer's sync leaves it alone until the wait is over...
      const tries = feed.syncs;
      vi.setSystemTime(Date.now() + seconds * SECOND - 1);
      await app!.calendars.syncAll();
      expect(feed.syncs).toBe(tries);
      // ...and tries again as soon as it is.
      vi.setSystemTime(Date.now() + 1);
    }
  });

  it('starts over after one good sync', async () => {
    const { providers, ids, account } = await withAccounts('Feed');
    const [id] = ids;
    const feed = providers.get('Feed')!;
    feed.failWith = new Error('Server error 500');
    for (let i = 0; i < 4; i++) {
      await app!.calendars.syncAccount(id);
      vi.setSystemTime(account(id).nextRetryAt!);
    }
    expect(account(id).nextRetryAt).toBe(Date.now()); // the 4th wait (240 s) is just over

    feed.failWith = null;
    await app!.calendars.syncAccount(id);
    expect(account(id)).toMatchObject({ status: 'ok', lastError: null, nextRetryAt: null });

    // The next failure is back to the shortest wait.
    feed.failWith = new Error('Server error 500');
    await app!.calendars.syncAccount(id);
    expect(account(id).nextRetryAt).toBe(Date.now() + 30 * SECOND);
  });

  it('keeps syncing the other accounts', async () => {
    const { providers } = await withAccounts('Broken', 'Fine');
    const broken = providers.get('Broken')!;
    const fine = providers.get('Fine')!;
    broken.failWith = new Error('Server error 500');
    await app!.calendars.syncAll();
    const [brokenTries, fineTries] = [broken.syncs, fine.syncs];

    vi.setSystemTime(Date.now() + 5 * SECOND);
    await app!.calendars.syncAll();
    expect(broken.syncs).toBe(brokenTries);
    expect(fine.syncs).toBe(fineTries + 1);
  });

  it('tries at once on Sync now, and reports how long it will wait', async () => {
    const { providers, ids, account } = await withAccounts('Feed');
    const [id] = ids;
    const feed = providers.get('Feed')!;
    feed.failWith = new Error('Server error 500');
    await app!.calendars.syncAccount(id);
    const tries = feed.syncs;

    const res = await app!.inject('POST', `/api/accounts/${id}/sync`);
    expect(res.status).toBe(200);
    expect(feed.syncs).toBe(tries + 1);
    expect(res.body).toMatchObject({ status: 'error', paused: false });
    expect((res.body as AccountDTO).nextRetryAt).toBe(Date.now() + 60 * SECOND); // 2nd failure

    feed.failWith = null;
    await app!.inject('POST', `/api/accounts/${id}/sync`);
    expect(account(id)).toMatchObject({ status: 'ok', nextRetryAt: null });
  });
});

describe('a failed sign-in', () => {
  const rejected = () => new AuthError('The CalDAV server rejected the username or password.');

  it('stops automatic syncing and says so in plain words', async () => {
    const { providers, ids, account } = await withAccounts('iCloud');
    const [id] = ids;
    const icloud = providers.get('iCloud')!;
    icloud.failWith = rejected();
    await app!.calendars.syncAccount(id);
    const tries = icloud.syncs;

    expect(account(id)).toMatchObject({ status: 'error', paused: true, nextRetryAt: null });
    expect(account(id).lastError).toBe(
      "Sign-in failed. The CalDAV server rejected the username or password. Hearthboard stopped trying so your account doesn't get locked. If the password changed, remove the account and connect it again. Otherwise, press Sync now to try once more.",
    );

    // Not on the timer, however long it waits, and not when a calendar is switched back on.
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(Date.now() + 6 * HOUR);
      await app!.calendars.syncAll();
    }
    const [cal] = app!.calendars.listCalendars();
    app!.calendars.updateCalendar(cal.id, { enabled: false });
    app!.calendars.updateCalendar(cal.id, { enabled: true });
    await app!.calendars.syncAccount(id);
    expect(icloud.syncs).toBe(tries);
    expect(account(id).paused).toBe(true);
  });

  it('tries once more on Sync now, and carries on if that works', async () => {
    const { providers, ids, account } = await withAccounts('iCloud');
    const [id] = ids;
    const icloud = providers.get('iCloud')!;
    icloud.failWith = rejected();
    await app!.calendars.syncAccount(id);
    const tries = icloud.syncs;

    // Still wrong: it stays paused.
    let res = await app!.inject('POST', `/api/accounts/${id}/sync`);
    expect(icloud.syncs).toBe(tries + 1);
    expect(res.body).toMatchObject({ status: 'error', paused: true });

    // Sync now for everything counts too.
    res = await app!.inject('POST', '/api/sync');
    expect(icloud.syncs).toBe(tries + 2);
    expect((res.body as AccountDTO[])[0]).toMatchObject({ status: 'error', paused: true });

    icloud.failWith = null;
    await app!.inject('POST', `/api/accounts/${id}/sync`);
    expect(account(id)).toMatchObject({ status: 'ok', lastError: null, paused: false });

    // Automatic syncing is back.
    await app!.calendars.syncAll();
    expect(icloud.syncs).toBe(tries + 4);
  });

  it('is tried again after a restart', async () => {
    const { providers, ids, factory } = await withAccounts('iCloud');
    const icloud = providers.get('iCloud')!;
    icloud.failWith = rejected();
    await app!.calendars.syncAccount(ids[0]);
    const tries = icloud.syncs;

    // A restart forgets the pause: a new service over the same database tries again.
    const secrets = SecretBox.fromConfig(app!.config.secret, app!.config.dataDir);
    const restarted = new CalendarService(app!.db, secrets, app!.live, factory);
    await restarted.syncAll();
    expect(icloud.syncs).toBe(tries + 1);
  });
});
