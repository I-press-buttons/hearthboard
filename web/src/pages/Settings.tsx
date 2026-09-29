import { useEffect, useState } from 'react';
import type { AccountDTO, CalendarDTO, ChecklistDTO, SystemSettingsDTO } from '@hearthboard/shared';
import { api } from '../api';
import { useMe } from '../components/Auth';
import { Card, useAction } from '../components/Card';
import { Modal, TopBar } from '../components/TopBar';
import { AccountCard } from './settings/Account';
import { PeopleCard } from './settings/People';
import { useLiveQuery } from '../live';

function ago(ts: number | null) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleString();
}

function inTime(ts: number) {
  const s = Math.round((ts - Date.now()) / 1000);
  if (s < 60) return 'in under a minute';
  if (s < 3600) return `in ${Math.round(s / 60)} min`;
  return `in ${Math.round(s / 3600)} h`;
}

// ---------------- general ----------------

const SYNC_CHOICES: [number, string][] = [
  [15, 'Every 15 seconds'],
  [30, 'Every 30 seconds'],
  [60, 'Every minute'],
  [120, 'Every 2 minutes'],
  [300, 'Every 5 minutes'],
  [900, 'Every 15 minutes'],
  [1800, 'Every 30 minutes'],
  [3600, 'Every hour'],
];

function timeZones(current: string): string[] {
  const zones = Intl.supportedValuesOf('timeZone');
  return zones.includes(current) ? zones : [current, ...zones];
}

function GeneralCard() {
  const [form, setForm] = useState<SystemSettingsDTO | null>(null);
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    void run(async () => setForm(await api.get<SystemSettingsDTO>('/api/system')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!form)
    return <Card title="General">{error ? <div className="error-text">{error}</div> : '…'}</Card>;

  const set = (p: Partial<SystemSettingsDTO>) => {
    setSaved(false);
    setForm({ ...form, ...p });
  };
  const syncChoices = SYNC_CHOICES.some(([v]) => v === form.syncIntervalSec)
    ? SYNC_CHOICES
    : [...SYNC_CHOICES, [form.syncIntervalSec, `Every ${form.syncIntervalSec} seconds`] as const];

  return (
    <Card title="General">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaved(false);
          await run(async () => {
            setForm(
              await api.put<SystemSettingsDTO>('/api/system', {
                ...form,
                publicUrl: form.publicUrl?.trim() || null,
              }),
            );
            setSaved(true);
          });
        }}
      >
        <label className="field">
          <span>Time zone: decides “today”, all-day events and when checklists reset</span>
          <div className="row">
            <select
              className="grow"
              value={form.timeZone}
              onChange={(e) => set({ timeZone: e.target.value })}
            >
              {timeZones(form.timeZone).map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            {deviceZone && deviceZone !== form.timeZone && (
              <button
                type="button"
                className="btn small"
                onClick={() => set({ timeZone: deviceZone })}
              >
                Use {deviceZone.replace(/_/g, ' ')}
              </button>
            )}
          </div>
        </label>
        <label className="field">
          <span>Check calendars for changes</span>
          <select
            value={form.syncIntervalSec}
            onChange={(e) => set({ syncIntervalSec: Number(e.target.value) })}
          >
            {syncChoices.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Public HTTPS address (optional)</span>
          <div className="row">
            <input
              className="grow"
              type="url"
              placeholder="https://board.example.synology.me"
              value={form.publicUrl ?? ''}
              onChange={(e) => set({ publicUrl: e.target.value })}
            />
            {location.protocol === 'https:' && form.publicUrl !== location.origin && (
              <button
                type="button"
                className="btn small"
                onClick={() => set({ publicUrl: location.origin })}
              >
                Use this address
              </button>
            )}
          </div>
        </label>
        <p className="hint">
          If the board is reachable over HTTPS with a real name (for example DSM's reverse proxy
          with a Let's Encrypt certificate), enter it here and Google sign-in comes straight back to
          Settings. Add{' '}
          <code>
            {(form.publicUrl?.trim() || 'https://…').replace(/\/+$/, '')}/api/google/callback
          </code>{' '}
          as an authorized redirect URI of a <b>Web application</b> OAuth client. Leave it empty to
          copy and paste the address instead.
        </p>
        {error && <div className="error-text">{error}</div>}
        {saved && <div className="status-ok">Saved.</div>}
        <button className="btn primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Card>
  );
}

// ---------------- calendars ----------------

function CalDavDialog({ preset, onClose }: { preset: 'icloud' | 'custom'; onClose: () => void }) {
  const [form, setForm] = useState({
    name: preset === 'icloud' ? 'iCloud' : 'CalDAV',
    serverUrl: '',
    username: '',
    password: '',
  });
  const { busy, error, run } = useAction();
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  return (
    <Modal
      title={preset === 'icloud' ? 'Connect Apple iCloud Calendar' : 'Connect a CalDAV calendar'}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api.post('/api/accounts/caldav', { ...form, preset }))) onClose();
        }}
      >
        {preset === 'icloud' ? (
          <p className="hint">
            Use an <b>app-specific password</b>, not your Apple ID password: sign in at{' '}
            <a href="https://account.apple.com" target="_blank" rel="noreferrer">
              account.apple.com
            </a>{' '}
            → Sign-In and Security → App-Specific Passwords → “+”, name it “Hearthboard”.
          </p>
        ) : (
          <>
            <p className="hint">
              Works with Synology Calendar (the CalDAV address is shown in Synology Calendar →
              Settings → CalDAV Account), Nextcloud, Fastmail and others.
            </p>
            <label className="field">
              <span>Server URL</span>
              <input
                type="url"
                required
                value={form.serverUrl}
                placeholder="https://nas.local:5001/caldav/"
                onChange={(e) => set({ serverUrl: e.target.value })}
              />
            </label>
          </>
        )}
        <label className="field">
          <span>{preset === 'icloud' ? 'Apple ID (email)' : 'Username'}</span>
          <input
            type="text"
            required
            autoComplete="username"
            value={form.username}
            onChange={(e) => set({ username: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{preset === 'icloud' ? 'App-specific password' : 'Password'}</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={form.password}
            placeholder={preset === 'icloud' ? 'xxxx-xxxx-xxxx-xxxx' : ''}
            onChange={(e) => set({ password: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Name on the board</span>
          <input type="text" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function GoogleDialog({ onClose }: { onClose: () => void }) {
  const [creds, setCreds] = useState({ clientId: '', clientSecret: '' });
  const [started, setStarted] = useState<{
    authUrl: string;
    state: string;
    redirectUri: string;
  } | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('Google');
  const { busy, error, run } = useAction();
  const loopback = started?.redirectUri.startsWith('http://127.0.0.1');

  return (
    <Modal title="Connect Google Calendar" onClose={onClose}>
      {!started ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => setStarted(await api.post('/api/accounts/google/start', creds)));
          }}
        >
          <p className="hint">
            Google needs your own (free) OAuth client. Create a Google Cloud project, enable the
            Google Calendar API, then create an OAuth client of type <b>Desktop app</b> and paste
            its ID and secret here (a <b>Web application</b> client if you set a public HTTPS
            address under General). Set the consent screen's publishing status to{' '}
            <b>In production</b>, or Google signs the board out every 7 days. Full steps are in{' '}
            <code>docs/google-setup.md</code>.
          </p>
          <label className="field">
            <span>Client ID</span>
            <input
              type="text"
              required
              value={creds.clientId}
              onChange={(e) => setCreds({ ...creds, clientId: e.target.value.trim() })}
            />
          </label>
          <label className="field">
            <span>Client secret</span>
            <input
              type="password"
              required
              value={creds.clientSecret}
              onChange={(e) => setCreds({ ...creds, clientSecret: e.target.value.trim() })}
            />
          </label>
          {error && <div className="error-text">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy}>
              Next
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run(() =>
                api.post('/api/accounts/google/finish', { state: started.state, code, name }),
              )
            )
              onClose();
          }}
        >
          <p className="hint">
            1.{' '}
            <a href={started.authUrl} target="_blank" rel="noreferrer">
              Open Google sign-in ↗
            </a>{' '}
            and allow calendar access. Google may warn that the app isn't verified: that's your own
            client, so choose Advanced → Continue.
          </p>
          {loopback ? (
            <p className="hint">
              2. Google then sends your browser to a <code>127.0.0.1</code> page that{' '}
              <b>fails to load</b>. That's expected. Copy the whole address from the address bar and
              paste it below.
            </p>
          ) : (
            <p className="hint">
              2. You'll come back to Settings automatically. If not, paste the address you landed on
              below.
            </p>
          )}
          <label className="field">
            <span>Address (or code) from the browser</span>
            <input
              type="text"
              required
              value={code}
              placeholder="http://127.0.0.1:53682/?state=…&code=…"
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Name on the board</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {error && <div className="error-text">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setStarted(null)}>
              Back
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? 'Connecting…' : 'Finish'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Public holiday calendars Google publishes as .ics feeds. */
const FEED_PRESETS: [string, string][] = [
  ['US holidays', 'en.usa'],
  ['UK holidays', 'en.uk'],
  ['Canadian holidays', 'en.canadian'],
  ['Australian holidays', 'en.australian'],
  ['Christian holidays', 'en.christian'],
];
const presetUrl = (id: string) =>
  `https://calendar.google.com/calendar/ical/${encodeURIComponent(`${id}#holiday@group.v.calendar.google.com`)}/public/basic.ics`;

function FeedDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ url: '', name: '' });
  const { busy, error, run } = useAction();
  return (
    <Modal title="Subscribe to a calendar" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api.post('/api/accounts/ics', form))) onClose();
        }}
      >
        <p className="hint">
          Any calendar with an <b>.ics</b> or <b>webcal://</b> address: school and sports schedules,
          holidays, a Google calendar's “secret address in iCal format”, or a public iCloud
          calendar. These are read-only on the board and are checked every 15 minutes.
        </p>
        <div className="field">
          <span>Quick picks</span>
          <div className="chips">
            {FEED_PRESETS.map(([label, id]) => (
              <span
                key={id}
                className={`chip ${form.url === presetUrl(id) ? 'on' : ''}`}
                onClick={() => setForm({ url: presetUrl(id), name: label })}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Calendar address</span>
          <input
            type="text"
            inputMode="url"
            required
            placeholder="webcal://… or https://….ics"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Name on the board (optional)</span>
          <input
            type="text"
            placeholder="Uses the calendar's own name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Checking…' : 'Subscribe'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CalendarsCard() {
  const { data: accounts, reload: reloadAccounts } = useLiveQuery(
    ['calendars'],
    () => api.get<AccountDTO[]>('/api/accounts'),
    [],
    30_000,
  );
  const { data: calendars, reload } = useLiveQuery(
    ['calendars'],
    () => api.get<CalendarDTO[]>('/api/calendars'),
    [],
  );
  const [dialog, setDialog] = useState<null | 'icloud' | 'custom' | 'google' | 'feed'>(null);
  const { error, run } = useAction();
  const googleResult = new URLSearchParams(location.search).get('google');

  const patch = (id: string, body: Partial<CalendarDTO>) =>
    void run(() => api.patch(`/api/calendars/${id}`, body)).then(reload);

  return (
    <Card
      title="Calendars"
      hint="Events you add, drag or edit on the board are saved back to the calendar they belong to. Changes made on your phone show up within a minute."
    >
      {googleResult && googleResult !== 'ok' && (
        <div className="error-text">Google: {googleResult}</div>
      )}
      {(accounts ?? []).map((a) => (
        <div key={a.id} style={{ marginBottom: 12 }}>
          <div className="table-row">
            <b style={{ flex: 1 }}>
              {a.name}{' '}
              <span className="hint">
                (
                {a.provider === 'caldav'
                  ? 'iCloud / CalDAV'
                  : a.provider === 'google'
                    ? 'Google'
                    : a.provider === 'ics'
                      ? 'Subscribed'
                      : 'Demo'}
                )
              </span>
            </b>
            <span
              className={a.status === 'error' ? 'status-error' : 'status-ok'}
              style={{ fontSize: 13 }}
            >
              {a.paused
                ? '⚠ paused'
                : a.status === 'error'
                  ? '⚠ error'
                  : `synced ${ago(a.lastSync)}`}
            </span>
            <button
              className="btn small"
              onClick={() =>
                void run(() => api.post(`/api/accounts/${a.id}/sync`)).then(reloadAccounts)
              }
            >
              Sync now
            </button>
            <button
              className="btn small danger"
              onClick={() =>
                confirm(`Disconnect ${a.name}? Its events disappear from the board.`) &&
                void run(() => api.del(`/api/accounts/${a.id}`)).then(reloadAccounts)
              }
            >
              Remove
            </button>
          </div>
          {a.lastError && <div className="error-text">{a.lastError}</div>}
          {a.status === 'error' && a.nextRetryAt && (
            <div className="hint" style={{ margin: '0 0 6px' }}>
              Hearthboard will try again {inTime(a.nextRetryAt)}, or press Sync now.
            </div>
          )}
          {(calendars ?? [])
            .filter((c) => c.accountId === a.id)
            .map((c) => (
              <div key={c.id} className="table-row" style={{ paddingLeft: 12 }}>
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => patch(c.id, { enabled: e.target.checked })}
                  title="Show on the board"
                />
                <input
                  type="color"
                  value={c.color}
                  onChange={(e) => patch(c.id, { color: e.target.value })}
                  title="Colour"
                />
                <span style={{ flex: 1 }}>{c.name}</span>
                {!c.writable && <span className="hint">read-only</span>}
              </div>
            ))}
        </div>
      ))}
      {error && <div className="error-text">{error}</div>}
      <div className="row">
        <button className="btn primary" onClick={() => setDialog('icloud')}>
          Add iCloud
        </button>
        <button className="btn primary" onClick={() => setDialog('google')}>
          Add Google
        </button>
        <button className="btn" onClick={() => setDialog('custom')}>
          Add other CalDAV
        </button>
        <button className="btn" onClick={() => setDialog('feed')}>
          Subscribe to a calendar (holidays, school…)
        </button>
      </div>
      {dialog === 'feed' && (
        <FeedDialog
          onClose={() => {
            setDialog(null);
            reloadAccounts();
          }}
        />
      )}
      {(dialog === 'icloud' || dialog === 'custom') && (
        <CalDavDialog
          preset={dialog}
          onClose={() => {
            setDialog(null);
            reloadAccounts();
          }}
        />
      )}
      {dialog === 'google' && (
        <GoogleDialog
          onClose={() => {
            setDialog(null);
            reloadAccounts();
          }}
        />
      )}
    </Card>
  );
}

// ---------------- reminders ----------------

function RemindersCard() {
  const { data, reload } = useLiveQuery(
    ['reminders'],
    () => api.get<{ token: string; lastIngest: number | null }>('/api/reminders/setup'),
    [],
  );
  const [show, setShow] = useState(false);
  const url = `${location.origin}/api/reminders/ingest`;
  return (
    <Card
      title="Apple Reminders"
      hint={
        <>
          Apple doesn't let other apps read iCloud Reminders, so an iPhone Shortcut sends them here.
          Build it once (about 5 minutes, steps in <code>docs/reminders-shortcut.md</code>) and add
          a Personal Automation to run it. Ticking a reminder on the board is passed back to the
          Shortcut, which completes it on the next run.
        </>
      }
    >
      <div className="field">
        <span>URL (Get Contents of URL → POST, Request Body: JSON)</span>
        <code>{url}</code>
      </div>
      <div className="field">
        <span>Header “Authorization”</span>
        <div className="row">
          <code className="grow">Bearer {show ? data?.token : '••••••••••••••••'}</code>
          <button className="btn small" onClick={() => setShow((s) => !s)}>
            {show ? 'Hide' : 'Show'}
          </button>
          <button
            className="btn small"
            onClick={() =>
              confirm('Make a new token? The Shortcut must be updated with it.') &&
              void api.post('/api/reminders/token').then(reload)
            }
          >
            New token
          </button>
        </div>
      </div>
      <p className="hint">Last received from the iPhone: {ago(data?.lastIngest ?? null)}</p>
    </Card>
  );
}

// ---------------- photos ----------------

function PhotosCard() {
  const { data, reload } = useLiveQuery(
    ['photos'],
    () =>
      api.get<{
        folder: { path: string; available: boolean; count: number };
        synology: { configured: boolean; url?: string; username?: string; insecure?: boolean };
      }>('/api/photos/status'),
    [],
  );
  const [form, setForm] = useState({ url: '', username: '', password: '', insecure: false });
  const { busy, error, run } = useAction();
  const [ok, setOk] = useState<string | null>(null);

  return (
    <Card title="Photos">
      <div className="table-row">
        <span style={{ flex: 1 }}>
          Photo folder <code>{data?.folder.path}</code>
        </span>
        {data &&
          (data.folder.available ? (
            <span className="status-ok">{data.folder.count} photos</span>
          ) : (
            <span className="status-error">not mounted</span>
          ))}
      </div>
      <p className="hint">
        Mount your Synology Photos folder read-only at <code>/photos</code> (see{' '}
        <code>docker-compose.yml</code>):
        <code>/volume1/homes/&lt;you&gt;/Photos</code> for your personal space, or{' '}
        <code>/volume1/photo</code> for the shared space. iPhone HEIC photos use the previews
        Synology Photos already made.
      </p>
      <div className="table-row">
        <span style={{ flex: 1 }}>Synology Photos albums</span>
        {data?.synology.configured ? (
          <>
            <span className="status-ok">
              {data.synology.username} @ {data.synology.url}
            </span>
            <button
              className="btn small danger"
              onClick={() => void api.del('/api/photos/synology').then(reload)}
            >
              Remove
            </button>
          </>
        ) : (
          <span className="hint">not set up</span>
        )}
      </div>
      <p className="hint">
        Optional: to show a specific album, sign in to the Synology Photos API with a DSM account
        that has no 2-factor sign-in (a separate read-only “wallboard” user is best; share the
        albums with it).
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setOk(null);
          if (
            await run(async () => {
              const r = await api.post<{ albums: unknown[] }>('/api/photos/synology', form);
              setOk(`Connected: ${r.albums.length} albums found.`);
            })
          ) {
            setForm({ ...form, password: '' });
            reload();
          }
        }}
      >
        <div className="row">
          <label className="field grow">
            <span>DSM address</span>
            <input
              type="url"
              required
              placeholder="http://192.168.1.10:5000"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </label>
        </div>
        <div className="row">
          <label className="field grow">
            <span>Username</span>
            <input
              type="text"
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label className="field grow">
            <span>Password</span>
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
        </div>
        <label className="field inline">
          <span>Allow self-signed HTTPS certificate</span>
          <input
            type="checkbox"
            checked={form.insecure}
            onChange={(e) => setForm({ ...form, insecure: e.target.checked })}
          />
        </label>
        {error && <div className="error-text">{error}</div>}
        {ok && <div className="status-ok">{ok}</div>}
        <button className="btn" disabled={busy}>
          {busy
            ? 'Checking…'
            : data?.synology.configured
              ? 'Replace sign-in'
              : 'Connect Synology Photos'}
        </button>
      </form>
    </Card>
  );
}

// ---------------- checklists ----------------

function ChecklistEditor({ list, reload }: { list: ChecklistDTO; reload: () => void }) {
  const [text, setText] = useState('');
  const base = `/api/checklists/${list.id}`;
  const act = (p: Promise<unknown>) => void p.then(reload, (e: Error) => alert(e.message));
  return (
    <div style={{ padding: '4px 0 12px 12px' }}>
      {list.items.map((i) => (
        <div key={i.id} className="table-row">
          <input
            type="checkbox"
            checked={i.done}
            onChange={(e) => act(api.patch(`${base}/items/${i.id}`, { done: e.target.checked }))}
          />
          <span style={{ flex: 1 }}>{i.text}</span>
          <button
            className="btn small ghost"
            onClick={() => act(api.del(`${base}/items/${i.id}`))}
            aria-label="Remove item"
          >
            ✕
          </button>
        </div>
      ))}
      <form
        className="row"
        style={{ marginTop: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim())
            act(api.post(`${base}/items`, { text: text.trim() }).then(() => setText('')));
        }}
      >
        <input
          className="grow"
          type="text"
          placeholder="Add item…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn">Add</button>
      </form>
    </div>
  );
}

function ChecklistsCard() {
  const { data, reload } = useLiveQuery(
    ['checklists'],
    () => api.get<ChecklistDTO[]>('/api/checklists'),
    [],
  );
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  return (
    <Card
      title="Checklists"
      hint="“Reset daily” unticks everything at midnight: handy for chores and routines."
    >
      {(data ?? []).map((l) => (
        <div key={l.id}>
          <div className="table-row">
            <button
              className="btn small ghost"
              onClick={() => setOpen(open === l.id ? null : l.id)}
            >
              {open === l.id ? '▾' : '▸'}
            </button>
            <span style={{ flex: 1 }}>
              {l.name} <span className="hint">({l.items.length})</span>
            </span>
            <label className="row" style={{ fontSize: 13, gap: 6 }}>
              <input
                type="checkbox"
                checked={l.resetDaily}
                onChange={(e) =>
                  void api
                    .patch(`/api/checklists/${l.id}`, { resetDaily: e.target.checked })
                    .then(reload)
                }
              />
              Reset daily
            </label>
            <button
              className="btn small"
              onClick={() => {
                const n = prompt('Rename checklist', l.name);
                if (n) void api.patch(`/api/checklists/${l.id}`, { name: n }).then(reload);
              }}
            >
              Rename
            </button>
            <button
              className="btn small danger"
              onClick={() =>
                confirm(`Delete “${l.name}”?`) &&
                void api.del(`/api/checklists/${l.id}`).then(reload)
              }
            >
              Delete
            </button>
          </div>
          {open === l.id && <ChecklistEditor list={l} reload={reload} />}
        </div>
      ))}
      <form
        className="row"
        style={{ marginTop: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim())
            void api
              .post('/api/checklists', { name: name.trim() })
              .then(() => (setName(''), reload()));
        }}
      >
        <input
          className="grow"
          type="text"
          placeholder="New checklist name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn">Create</button>
      </form>
    </Card>
  );
}

// ---------------- quotes ----------------

function QuotesCard() {
  const { data, reload } = useLiveQuery(
    ['quotes'],
    () => api.get<{ id: string; text: string; source: string }[]>('/api/quotes/custom'),
    [],
  );
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  return (
    <Card
      title="Verses & quotes"
      hint="The verse widget uses a built-in list of verses from the ESV® Bible (English Standard Version®), copyright © 2001 by Crossway, used by permission. Add your own verses, family sayings or quotes here, and set a widget to “My own entries”."
    >
      {(data ?? []).map((q) => (
        <div key={q.id} className="table-row">
          <span style={{ flex: 1 }}>
            {q.text} {q.source && <span className="hint">— {q.source}</span>}
          </span>
          <button
            className="btn small ghost"
            onClick={() => void api.del(`/api/quotes/custom/${q.id}`).then(reload)}
          >
            ✕
          </button>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void api
            .post('/api/quotes/custom', { text: text.trim(), source: source.trim() })
            .then(() => {
              setText('');
              setSource('');
              reload();
            });
        }}
        style={{ marginTop: 10 }}
      >
        <label className="field">
          <span>Text</span>
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="row">
          <input
            className="grow"
            type="text"
            placeholder="Source (e.g. Psalm 23:1 NIV, Grandma)"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <button className="btn">Add</button>
        </div>
      </form>
    </Card>
  );
}

export function Settings() {
  const { user } = useMe();
  const admin = user.role === 'admin';
  return (
    <div className="app">
      <TopBar active="settings" />
      <div className="page">
        <div className="page-inner">
          <AccountCard />
          {admin && <PeopleCard />}
          {admin && <GeneralCard />}
          {admin && <CalendarsCard />}
          {admin && <RemindersCard />}
          {admin && <PhotosCard />}
          <ChecklistsCard />
          <QuotesCard />
        </div>
      </div>
    </div>
  );
}
