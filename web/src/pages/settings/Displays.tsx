import { useEffect, useState } from 'react';
import {
  formatPairCode,
  type DisplayAccess,
  type DisplayDTO,
  type DisplaysDTO,
  type NewDisplayDTO,
} from '@hearthboard/shared';
import { api } from '../../api';
import { Card, useAction } from '../../components/Card';
import { Modal } from '../../components/TopBar';

/** Last-seen is only noted about once an hour, so anything newer than that is "just now". */
function seen(d: DisplayDTO) {
  if (d.waiting || !d.lastSeen) return 'Waiting for its link to be opened';
  const hours = (Date.now() - d.lastSeen) / 3600_000;
  if (hours < 1.1) return 'Active within the last hour';
  if (hours < 24) return `Last seen ${Math.round(hours)} h ago`;
  return `Last seen ${new Date(d.lastSeen).toLocaleDateString()}`;
}

function RenameDialog({ display, onClose }: { display: DisplayDTO; onClose: () => void }) {
  const [name, setName] = useState(display.name);
  const { busy, error, run } = useAction();
  return (
    <Modal title={`Rename ${display.name}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api.patch(`/api/displays/${display.id}`, { name }))) onClose();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !name.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** For a screen that's awkward to type on: a link to open on it, once. */
function LinkDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <Modal title="Pair with a link" onClose={onClose}>
      {link === null ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await run(async () => {
              const made = await api.post<NewDisplayDTO>('/api/displays', { name });
              // The address you're using now is the one the screen can be expected to reach too.
              setLink(`${location.origin}/pair${new URL(made.url).hash}`);
            });
          }}
        >
          <p className="hint">
            Name the screen, then open the link you get on it. Useful when typing a code is a
            bother, or the screen's browser is on another device.
          </p>
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              required
              autoFocus
              placeholder="Kitchen TV"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {error && <div className="error-text">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy || !name.trim()}>
              Make the link
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="hint">
            Open this link on the screen. It works once, and runs out in 24 hours. Anyone with it
            can pair a screen until then, so don't share it.
          </p>
          <div className="row">
            <input
              className="grow"
              type="text"
              readOnly
              aria-label="Pairing link"
              value={link}
              onFocus={(e) => e.target.select()}
            />
            <button
              className="btn"
              onClick={() =>
                void navigator.clipboard?.writeText(link).then(
                  () => setCopied(true),
                  () => {},
                )
              }
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="modal-actions">
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function DisplaysCard() {
  const [data, setData] = useState<DisplaysDTO | null>(null);
  const [form, setForm] = useState({ code: '', name: '' });
  const [paired, setPaired] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DisplayDTO | 'link' | null>(null);
  const { busy, error, run } = useAction();

  const load = async () => setData(await api.get<DisplaysDTO>('/api/displays'));
  useEffect(() => {
    void run(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAccess = (access: DisplayAccess) =>
    run(async () => {
      await api.put('/api/displays/access', { access });
      await load();
    });
  const open = data?.access === 'open';

  return (
    <Card
      title="Displays"
      hint="Screens that show your board without anyone signing in: the kitchen TV, a wall tablet. Each one is paired once, and boards stay private to paired screens and signed-in people."
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setPaired(null);
          await run(async () => {
            const display = await api.post<DisplayDTO>('/api/displays/approve', form);
            setPaired(display.name);
            setForm({ code: '', name: '' });
            await load();
          });
        }}
      >
        <h3 style={{ marginTop: 0 }}>Pair a screen</h3>
        <p className="hint">
          Open Hearthboard on the screen. It shows a code: enter it here and give the screen a name.
        </p>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ margin: 0 }}>
            <span>Code shown on the screen</span>
            <input
              type="text"
              required
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="ABCD-EFGH"
              style={{ width: 150, letterSpacing: '0.12em' }}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: formatPairCode(e.target.value) })}
            />
          </label>
          <label className="field grow" style={{ margin: 0 }}>
            <span>Name</span>
            <input
              type="text"
              required
              placeholder="Kitchen TV"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <button
            className="btn primary"
            disabled={busy || form.code.length < 9 || !form.name.trim()}
          >
            Pair
          </button>
        </div>
        {paired && (
          <div className="status-ok" style={{ marginTop: 8 }}>
            Paired “{paired}”.
          </div>
        )}
      </form>

      <h3>Paired screens</h3>
      {data && data.displays.length === 0 && (
        <p className="hint" style={{ margin: 0 }}>
          None yet. Until you pair one, boards show only to people who are signed in.
        </p>
      )}
      {data?.displays.map((d) => (
        <div key={d.id} className="table-row">
          <span style={{ flex: 1 }}>
            <b>{d.name}</b>
          </span>
          <span className="hint" style={{ margin: 0 }}>
            {seen(d)}
          </span>
          <button className="btn small" onClick={() => setDialog(d)}>
            Rename
          </button>
          <button
            className="btn small danger"
            onClick={() =>
              confirm(`Remove ${d.name}? It goes back to showing a pairing code.`) &&
              void run(() => api.del(`/api/displays/${d.id}`)).then(load)
            }
          >
            Remove
          </button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => setDialog('link')}>
          Pair with a link instead
        </button>
      </div>

      <label className="field inline" style={{ marginTop: 16, marginBottom: 0 }}>
        <span>
          Show boards on any device, without pairing
          <br />
          <span className="hint">
            How screens worked before pairing. Off is safer: only paired screens and signed-in
            people see your boards.
          </span>
        </span>
        <input
          type="checkbox"
          checked={open}
          disabled={busy || !data}
          onChange={(e) => {
            if (
              e.target.checked &&
              !confirm(
                'Let any device show your boards? Anyone who can reach Hearthboard will see your calendar, reminders, notes and photos without signing in.',
              )
            )
              return;
            void setAccess(e.target.checked ? 'open' : 'paired');
          }}
        />
      </label>
      {open && (
        <p className="hint notice warn">
          <b>Boards are open to everyone.</b> Anyone who can reach this address, on your network or
          over the internet if you've published it, can see your calendar, reminders, notes, meals
          and photos without signing in. Switch this off to show boards only on paired screens.
        </p>
      )}

      {error && <div className="error-text">{error}</div>}
      {dialog === 'link' && (
        <LinkDialog
          onClose={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
      {dialog && dialog !== 'link' && (
        <RenameDialog
          display={dialog}
          onClose={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
    </Card>
  );
}
