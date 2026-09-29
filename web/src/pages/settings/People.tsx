import { useEffect, useState } from 'react';
import { MIN_PASSWORD_LENGTH, type Role, type UserDTO } from '@hearthboard/shared';
import { api } from '../../api';
import { useMe } from '../../components/Auth';
import { Card, useAction } from '../../components/Card';
import { Modal } from '../../components/TopBar';

function PersonDialog({ person, onClose }: { person: UserDTO | null; onClose: () => void }) {
  const [form, setForm] = useState({
    name: person?.name ?? '',
    username: person?.username ?? '',
    role: (person?.role ?? 'member') as Role,
    password: '',
  });
  const { busy, error, run } = useAction();
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  const save = () => {
    if (!person) return api.post('/api/users', form);
    const { password, ...rest } = form;
    return api.patch(`/api/users/${person.id}`, password ? form : rest);
  };

  return (
    <Modal title={person ? `Edit ${person.name}` : 'Add a person'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(save)) onClose();
        }}
      >
        {!person && (
          <p className="hint">
            They get their own sign-in and a board of their own to arrange. They sign in at{' '}
            <code>{location.origin}/edit</code>.
          </p>
        )}
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            required
            autoFocus
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Username</span>
          <input
            type="text"
            required
            autoCapitalize="none"
            autoComplete="off"
            value={form.username}
            onChange={(e) => set({ username: e.target.value.toLowerCase() })}
          />
        </label>
        <label className="field">
          <span>
            {person ? 'New password (leave empty to keep theirs)' : 'Password'} (
            {MIN_PASSWORD_LENGTH}+ characters)
          </span>
          <input
            type="password"
            required={!person}
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => set({ password: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={form.role} onChange={(e) => set({ role: e.target.value as Role })}>
            <option value="member">Member: their own boards, the calendar, lists</option>
            <option value="admin">Admin: also people, calendar accounts, photos</option>
          </select>
        </label>
        {person?.mfa && (
          <div className="field">
            <span>Two-step sign-in is on</span>
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() =>
                confirm(
                  `Turn off ${person.name}'s two-step sign-in? Do this if they lost their phone and recovery codes; they can set it up again afterwards.`,
                ) &&
                void run(() => api.patch(`/api/users/${person.id}`, { resetMfa: true })).then(
                  (ok) => ok && onClose(),
                )
              }
            >
              Turn off their two-step sign-in
            </button>
          </div>
        )}
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {person ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PeopleCard() {
  const { user: me, requireMfa, refresh } = useMe();
  const [people, setPeople] = useState<UserDTO[]>([]);
  const [dialog, setDialog] = useState<UserDTO | 'new' | null>(null);
  const { busy, error, run } = useAction();

  const load = () => api.get<UserDTO[]>('/api/users').then(setPeople);
  // Also after you change your own two-step sign-in in the card above.
  useEffect(() => {
    void load();
  }, [me.mfa]);

  return (
    <Card
      title="People"
      hint="Everyone gets their own sign-in and their own boards. Members can arrange their boards, edit the calendar and use lists; admins also manage people and the household's accounts."
    >
      {people.map((p) => (
        <div key={p.id} className="table-row">
          <span style={{ flex: 1 }}>
            <b>{p.name}</b> <span className="hint">({p.username})</span>
            {p.id === me.id && <span className="hint"> · you</span>}
          </span>
          <span className="hint" style={{ margin: 0 }}>
            {p.role === 'admin' ? 'Admin' : 'Member'}
          </span>
          <span
            className={p.mfa ? 'status-ok' : 'hint'}
            style={{ fontSize: 13, margin: 0 }}
            title={p.mfa ? 'Two-step sign-in is on' : 'Signs in with a password only'}
          >
            {p.mfa ? '✓ two-step' : 'password only'}
          </span>
          <button className="btn small" onClick={() => setDialog(p)}>
            Edit
          </button>
          {p.id !== me.id && (
            <button
              className="btn small danger"
              onClick={() =>
                confirm(`Remove ${p.name}? Their boards become yours.`) &&
                void run(() => api.del(`/api/users/${p.id}`)).then(load)
              }
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={() => setDialog('new')}>
          Add a person
        </button>
      </div>
      <label className="field inline" style={{ marginTop: 16, marginBottom: 0 }}>
        <span>
          Require two-step sign-in for everyone
          <br />
          <span className="hint">
            Anyone signed in without it is signed out, and sets it up when they sign in again.
          </span>
        </span>
        <input
          type="checkbox"
          checked={requireMfa}
          disabled={busy}
          onChange={(e) =>
            void run(() => api.put('/api/auth/policy', { requireMfa: e.target.checked })).then(
              refresh,
            )
          }
        />
      </label>
      {error && <div className="error-text">{error}</div>}
      {dialog && (
        <PersonDialog
          person={dialog === 'new' ? null : dialog}
          onClose={() => {
            setDialog(null);
            void load();
            refresh();
          }}
        />
      )}
    </Card>
  );
}
