import crypto from 'node:crypto';
import type {
  AccountDTO,
  CalendarDTO,
  EventDelete,
  EventDTO,
  EventInput,
  EventPatch,
  ProviderKind,
} from '@hearthboard/shared';
import type { DB } from '../db';
import type { LiveHub } from '../live';
import type { SecretBox } from '../secrets';
import { errorMessage, HttpError, shortHash } from '../util';
import { CalDavProvider, type CalDavSecret } from './caldav';
import { DemoProvider } from './demo';
import { IcsFeedProvider, type FeedSecret } from './feed';
import { GoogleProvider, googleOccurrence, type GoogleSecret } from './google';
import { expandIcs, type Occurrence } from './ics';
import {
  AuthError,
  ConflictError,
  type CalendarProvider,
  type RemoteResource,
  type SyncWindow,
  type WriteResult,
} from './provider';

interface AccountRow {
  id: string;
  provider: ProviderKind;
  name: string;
  secret: string | null;
  meta: string;
  status: 'ok' | 'error' | 'syncing';
  last_error: string | null;
  last_sync: number | null;
}

interface CalendarRow {
  id: string;
  account_id: string;
  remote_id: string;
  name: string;
  color: string | null;
  enabled: number;
  writable: number;
  cursor: string | null;
}

interface ResourceRow {
  id: string;
  calendar_id: string;
  remote_id: string;
  etag: string | null;
  kind: 'ics' | 'gevent';
  payload: string;
  updated_at: number;
}

const PALETTE = [
  '#f59e0b',
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#fb7185',
  '#facc15',
  '#60a5fa',
];
const DAY = 86_400_000;
const CALENDAR_LIST_REFRESH_MS = 15 * 60_000;
/** The longest an account that keeps failing waits between automatic tries. */
const MAX_BACKOFF_MS = 6 * 60 * 60_000;
const SIGN_IN_PAUSED =
  "Hearthboard stopped trying so your account doesn't get locked. If the password changed, remove the account and connect it again. Otherwise, press Sync now to try once more.";

/** What we remember about an account that failed to sync. Lost on restart, which is fine. */
interface Trouble {
  failures: number;
  /** Timer syncs skip the account until then. */
  nextAttemptAt: number;
  /** Sign-in failed: no automatic tries at all, only "Sync now". */
  paused: boolean;
}

export type ProviderFactory = (provider: ProviderKind, secret: unknown) => CalendarProvider;

export const defaultProviderFactory: ProviderFactory = (provider, secret) => {
  switch (provider) {
    case 'caldav':
      return new CalDavProvider(secret as CalDavSecret);
    case 'google':
      return new GoogleProvider(secret as GoogleSecret);
    case 'ics':
      return new IcsFeedProvider(secret as FeedSecret);
    case 'demo':
      return DemoProvider.seeded();
  }
};

/** Window kept in the local cache: 3 months back, ~13 months ahead. */
export function syncWindow(now = new Date()): SyncWindow {
  const start = new Date(now.getTime() - 92 * DAY);
  start.setHours(0, 0, 0, 0);
  return { start, end: new Date(start.getTime() + 500 * DAY) };
}

export class CalendarService {
  private providers = new Map<string, CalendarProvider>();
  private running = new Map<string, Promise<void>>();
  private listRefreshed = new Map<string, number>();
  private trouble = new Map<string, Trouble>();
  private intervalMs = 60_000;
  private expansions = new Map<string, { key: string; occ: Occurrence[] }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private db: DB,
    private secrets: SecretBox,
    private live: LiveHub,
    private factory: ProviderFactory = defaultProviderFactory,
  ) {}

  // ---------- accounts & calendars ----------

  listAccounts(): AccountDTO[] {
    return (this.db.prepare('SELECT * FROM accounts ORDER BY rowid').all() as AccountRow[]).map(
      (a) => ({
        id: a.id,
        provider: a.provider,
        name: a.name,
        status: a.status,
        lastError: a.last_error,
        lastSync: a.last_sync,
        paused: !!this.trouble.get(a.id)?.paused,
        nextRetryAt: this.retryAt(a.id),
      }),
    );
  }

  listCalendars(): CalendarDTO[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, a.provider FROM calendars c JOIN accounts a ON a.id = c.account_id ORDER BY a.rowid, c.rowid`,
      )
      .all() as (CalendarRow & { provider: ProviderKind })[];
    return rows.map((c) => ({
      id: c.id,
      accountId: c.account_id,
      provider: c.provider,
      name: c.name,
      color: c.color ?? PALETTE[0],
      enabled: !!c.enabled,
      writable: !!c.writable,
    }));
  }

  /** Connect an account. Without a name, it's named after its first calendar. */
  async addAccount(
    provider: ProviderKind,
    name: string | null,
    secret: unknown,
  ): Promise<AccountDTO> {
    const id = crypto.randomBytes(6).toString('hex');
    const p = this.factory(provider, secret);
    // Fail fast on bad credentials before storing anything.
    const remote = await p.listCalendars();
    this.db
      .prepare('INSERT INTO accounts (id, provider, name, secret) VALUES (?, ?, ?, ?)')
      .run(id, provider, name || remote[0]?.name || provider, this.secrets.seal(secret));
    this.providers.set(id, p);
    this.storeCalendarList(id, remote);
    this.listRefreshed.set(id, Date.now());
    this.live.publish('calendars');
    void this.syncAccount(id);
    return this.listAccounts().find((a) => a.id === id)!;
  }

  removeAccount(id: string) {
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    this.providers.delete(id);
    this.trouble.delete(id);
    this.expansions.clear();
    this.live.publish('calendars');
    this.live.publish('events');
  }

  updateCalendar(id: string, patch: { enabled?: boolean; color?: string; name?: string }) {
    const cur = this.db.prepare('SELECT * FROM calendars WHERE id = ?').get(id) as
      CalendarRow | undefined;
    if (!cur) throw new HttpError(404, 'No such calendar');
    this.db
      .prepare('UPDATE calendars SET enabled = ?, color = ?, name = ? WHERE id = ?')
      .run(
        patch.enabled === undefined ? cur.enabled : patch.enabled ? 1 : 0,
        patch.color ?? cur.color,
        patch.name ?? cur.name,
        id,
      );
    this.live.publish('calendars');
    this.live.publish('events');
    if (patch.enabled && !cur.enabled) void this.syncAccount(cur.account_id);
  }

  private account(id: string): AccountRow {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as
      AccountRow | undefined;
    if (!row) throw new HttpError(404, 'No such account');
    return row;
  }

  private provider(accountId: string): CalendarProvider {
    let p = this.providers.get(accountId);
    if (!p) {
      const a = this.account(accountId);
      p = this.factory(a.provider, a.secret ? this.secrets.open(a.secret) : null);
      this.providers.set(accountId, p);
    }
    return p;
  }

  /** Test/demo hook: use a specific provider instance for an account. */
  setProvider(accountId: string, provider: CalendarProvider) {
    this.providers.set(accountId, provider);
  }

  private storeCalendarList(
    accountId: string,
    remote: Awaited<ReturnType<CalendarProvider['listCalendars']>>,
  ) {
    const existing = this.db
      .prepare('SELECT * FROM calendars WHERE account_id = ?')
      .all(accountId) as CalendarRow[];
    const byRemote = new Map(existing.map((c) => [c.remote_id, c]));
    const used = (this.db.prepare('SELECT COUNT(*) AS n FROM calendars').get() as { n: number }).n;
    const tx = this.db.transaction(() => {
      remote.forEach((r, i) => {
        const cur = byRemote.get(r.remoteId);
        if (cur) {
          this.db
            .prepare('UPDATE calendars SET name = ?, writable = ? WHERE id = ?')
            .run(r.name, r.writable ? 1 : 0, cur.id);
          byRemote.delete(r.remoteId);
        } else {
          this.db
            .prepare(
              'INSERT INTO calendars (id, account_id, remote_id, name, color, writable) VALUES (?, ?, ?, ?, ?, ?)',
            )
            .run(
              shortHash(accountId, r.remoteId),
              accountId,
              r.remoteId,
              r.name,
              r.color ?? PALETTE[(used + i) % PALETTE.length],
              r.writable ? 1 : 0,
            );
        }
      });
      for (const gone of byRemote.values())
        this.db.prepare('DELETE FROM calendars WHERE id = ?').run(gone.id);
    });
    tx();
  }

  // ---------- sync ----------

  start(intervalSec: number) {
    this.stop();
    this.intervalMs = intervalSec * 1000;
    const tick = () => void this.syncAll();
    tick();
    this.timer = setInterval(tick, intervalSec * 1000);
  }

  /** Change the polling interval if polling is running. */
  reschedule(intervalSec: number) {
    this.intervalMs = intervalSec * 1000;
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.syncAll(), intervalSec * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Sync every account. The timer calls it plain; "Sync now" passes `force`. */
  async syncAll(force = false) {
    const ids = (this.db.prepare('SELECT id FROM accounts').all() as { id: string }[]).map(
      (r) => r.id,
    );
    await Promise.all(ids.map((id) => this.syncAccount(id, force)));
  }

  /**
   * Sync one account; concurrent calls share the in-flight run. `force` (Sync now) skips
   * provider-side throttling, e.g. calendar feeds that are only downloaded every 15 minutes,
   * and tries even when the account is backing off or paused after a failure.
   */
  syncAccount(accountId: string, force = false): Promise<void> {
    const inflight = this.running.get(accountId);
    if (inflight) return inflight;
    if (!force && this.holdOff(accountId)) return Promise.resolve();
    const run = this.doSyncAccount(accountId, force).finally(() => this.running.delete(accountId));
    this.running.set(accountId, run);
    return run;
  }

  private async doSyncAccount(accountId: string, force: boolean) {
    let changed = false;
    try {
      const p = this.provider(accountId);
      if (Date.now() - (this.listRefreshed.get(accountId) ?? 0) > CALENDAR_LIST_REFRESH_MS) {
        this.storeCalendarList(accountId, await p.listCalendars());
        this.listRefreshed.set(accountId, Date.now());
      }
      const cals = this.db
        .prepare('SELECT * FROM calendars WHERE account_id = ? AND enabled = 1')
        .all(accountId) as CalendarRow[];
      for (const cal of cals) changed = (await this.syncCalendar(cal, force)) || changed;
      this.trouble.delete(accountId);
      this.setStatus(accountId, 'ok', null);
    } catch (err) {
      if (err instanceof AuthError) this.providers.delete(accountId);
      this.setStatus(accountId, 'error', this.recordFailure(accountId, err), true);
    }
    if (changed) this.live.publish('events');
  }

  /** True while timer syncs should leave an account alone: paused, or waiting out a back-off. */
  private holdOff(accountId: string): boolean {
    const t = this.trouble.get(accountId);
    return !!t && (t.paused || Date.now() < t.nextAttemptAt);
  }

  /** When the next automatic try is due, or null if there is no wait (or it's paused). */
  private retryAt(accountId: string): number | null {
    const t = this.trouble.get(accountId);
    return t && !t.paused ? t.nextAttemptAt : null;
  }

  /**
   * Remember a failed sync and return the message to show. Each failure doubles the wait
   * before the next automatic try. A failed sign-in stops automatic tries altogether:
   * repeating a wrong password is how accounts get locked, or the NAS blocks its own IP.
   */
  private recordFailure(accountId: string, err: unknown): string {
    const failures = (this.trouble.get(accountId)?.failures ?? 0) + 1;
    const wait = Math.min(this.intervalMs * 2 ** (failures - 1), MAX_BACKOFF_MS);
    const paused = err instanceof AuthError;
    this.trouble.set(accountId, { failures, nextAttemptAt: Date.now() + wait, paused });
    const why = errorMessage(err);
    return paused ? `Sign-in failed. ${why.replace(/[.\s]+$/, '')}. ${SIGN_IN_PAUSED}` : why;
  }

  private setStatus(
    accountId: string,
    status: AccountRow['status'],
    error: string | null,
    retryChanged = false,
  ) {
    const prev = this.db
      .prepare('SELECT status, last_error FROM accounts WHERE id = ?')
      .get(accountId) as Pick<AccountRow, 'status' | 'last_error'> | undefined;
    if (!prev) return;
    this.db
      .prepare('UPDATE accounts SET status = ?, last_error = ?, last_sync = ? WHERE id = ?')
      .run(status, error, status === 'ok' ? Date.now() : null, accountId);
    if (retryChanged || prev.status !== status || prev.last_error !== error)
      this.live.publish('calendars');
  }

  /** Pull remote changes for one calendar into the cache. Returns true if anything changed. */
  async syncCalendar(cal: CalendarRow, force = false): Promise<boolean> {
    const p = this.provider(cal.account_id);
    const result = await p.sync(
      { remoteId: cal.remote_id, cursor: cal.cursor, force },
      syncWindow(),
    );
    if (result.unchanged) return false;
    const tx = this.db.transaction(() => {
      if (result.full) {
        const keep = new Set(result.upserts.map((r) => r.remoteId));
        const stored = this.db
          .prepare('SELECT remote_id FROM resources WHERE calendar_id = ?')
          .all(cal.id) as {
          remote_id: string;
        }[];
        for (const s of stored)
          if (!keep.has(s.remote_id)) this.deleteResource(cal.id, s.remote_id);
      }
      for (const r of result.upserts) this.upsertResource(cal.id, r);
      for (const d of result.deletes) this.deleteResource(cal.id, d);
      this.db.prepare('UPDATE calendars SET cursor = ? WHERE id = ?').run(result.cursor, cal.id);
    });
    tx();
    return true;
  }

  private upsertResource(calendarId: string, r: RemoteResource): string {
    const id = shortHash(calendarId, r.remoteId);
    const prev = this.db.prepare('SELECT etag, payload FROM resources WHERE id = ?').get(id) as
      { etag: string | null; payload: string } | undefined;
    if (prev && prev.etag === r.etag && prev.payload === r.payload) return id;
    this.db
      .prepare(
        `INSERT INTO resources (id, calendar_id, remote_id, etag, kind, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET etag = excluded.etag, kind = excluded.kind,
           payload = excluded.payload, updated_at = excluded.updated_at`,
      )
      .run(id, calendarId, r.remoteId, r.etag, r.kind, r.payload, Date.now());
    this.expansions.delete(id);
    return id;
  }

  private deleteResource(calendarId: string, remoteId: string) {
    const id = shortHash(calendarId, remoteId);
    this.db.prepare('DELETE FROM resources WHERE id = ?').run(id);
    this.expansions.delete(id);
  }

  // ---------- reading ----------

  private occurrences(r: ResourceRow): Occurrence[] {
    const win = syncWindow();
    const key = `${r.updated_at}:${win.start.getTime()}`;
    const cached = this.expansions.get(r.id);
    if (cached?.key === key) return cached.occ;
    let occ: Occurrence[] = [];
    try {
      if (r.kind === 'ics') occ = expandIcs(r.payload, win.start, win.end);
      else {
        const o = googleOccurrence(r.payload);
        occ = o ? [o] : [];
      }
    } catch {
      occ = []; // unparseable object: skip rather than break the board
    }
    this.expansions.set(r.id, { key, occ });
    return occ;
  }

  events(from: Date, to: Date, calendarIds?: string[]): EventDTO[] {
    const cals = this.listCalendars().filter(
      (c) => c.enabled && (!calendarIds?.length || calendarIds.includes(c.id)),
    );
    const out: EventDTO[] = [];
    for (const cal of cals) {
      const rows = this.db
        .prepare('SELECT * FROM resources WHERE calendar_id = ?')
        .all(cal.id) as ResourceRow[];
      for (const r of rows) {
        for (const o of this.occurrences(r)) {
          const s = Date.parse(o.allDay ? o.start + 'T00:00:00' : o.start);
          const e = Date.parse(o.allDay ? o.end + 'T00:00:00' : o.end);
          if (s >= to.getTime() || Math.max(e, s + 1) <= from.getTime()) continue;
          out.push({
            id: `${r.id}|${o.recurrenceId ?? ''}`,
            resourceId: r.id,
            recurrenceId: o.recurrenceId,
            calendarId: cal.id,
            title: o.title,
            start: o.start,
            end: o.end,
            allDay: o.allDay,
            location: o.location,
            description: o.description,
            recurring: o.recurring,
            color: cal.color,
            editable: cal.writable,
          });
        }
      }
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  }

  // ---------- writing ----------

  private calendarRow(id: string): CalendarRow {
    const cal = this.db.prepare('SELECT * FROM calendars WHERE id = ?').get(id) as
      CalendarRow | undefined;
    if (!cal) throw new HttpError(404, 'No such calendar');
    if (!cal.writable) throw new HttpError(403, 'That calendar is read-only.');
    return cal;
  }

  private resourceRow(id: string): ResourceRow {
    const r = this.db.prepare('SELECT * FROM resources WHERE id = ?').get(id) as
      ResourceRow | undefined;
    if (!r) throw new HttpError(404, 'That event no longer exists. The board will refresh.');
    return r;
  }

  async createEvent(input: EventInput): Promise<string> {
    const cal = this.calendarRow(input.calendarId);
    const res = await this.provider(cal.account_id).create(
      { remoteId: cal.remote_id, cursor: cal.cursor },
      input,
    );
    const id = this.upsertResource(cal.id, res);
    this.live.publish('events');
    return id;
  }

  private async write(
    resourceId: string,
    op: (p: CalendarProvider, cal: CalendarRow, r: RemoteResource) => Promise<WriteResult>,
  ) {
    const r = this.resourceRow(resourceId);
    const cal = this.calendarRow(r.calendar_id);
    const p = this.provider(cal.account_id);
    let result: WriteResult;
    try {
      result = await op(p, cal, {
        remoteId: r.remote_id,
        etag: r.etag,
        kind: r.kind,
        payload: r.payload,
      });
    } catch (err) {
      if (err instanceof ConflictError) {
        await this.syncCalendar({ ...cal, cursor: null }).catch(() => {});
        this.live.publish('events');
        throw new HttpError(409, err.message);
      }
      throw err;
    }
    if (result === 'resync') await this.syncCalendar({ ...cal, cursor: cal.cursor });
    else if (result === null) this.deleteResource(cal.id, r.remote_id);
    else this.upsertResource(cal.id, result);
    this.live.publish('events');
  }

  updateEvent(resourceId: string, patch: EventPatch) {
    return this.write(resourceId, (p, cal, r) =>
      p.update({ remoteId: cal.remote_id, cursor: cal.cursor }, r, patch),
    );
  }

  deleteEvent(resourceId: string, del: EventDelete) {
    return this.write(resourceId, (p, cal, r) =>
      p.remove({ remoteId: cal.remote_id, cursor: cal.cursor }, r, del),
    );
  }
}
