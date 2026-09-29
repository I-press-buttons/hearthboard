import { useState } from 'react';
import { MIN_PASSWORD_LENGTH } from '@hearthboard/shared';
import { api } from '../../api';
import { useMe } from '../../components/Auth';
import { useAction } from '../../components/Card';
import { RecoveryCodes, TotpEnroll } from '../../components/TwoStep';

function ChangePassword() {
  const [form, setForm] = useState({ current: '', password: '' });
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setDone(false);
        if (await run(() => api.post('/api/auth/password', form))) {
          setForm({ current: '', password: '' });
          setDone(true);
        }
      }}
    >
      <h3>Password</h3>
      <div className="row">
        <input
          className="grow"
          type="password"
          required
          autoComplete="current-password"
          placeholder="Current password"
          value={form.current}
          onChange={(e) => setForm({ ...form, current: e.target.value })}
        />
        <input
          className="grow"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <button className="btn" disabled={busy}>
          Change
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
      {done && (
        <div className="status-ok">Password changed. Your other devices were signed out.</div>
      )}
    </form>
  );
}

/** Asks for the password before something sensitive. */
function ConfirmPassword({
  label,
  danger,
  onConfirm,
  onCancel,
}: {
  label: string;
  danger?: boolean;
  onConfirm: (password: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => onConfirm(password));
      }}
    >
      <div className="row">
        <input
          className="grow"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy}>
          {label}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}

function TwoStep() {
  const { user, requireMfa, refresh } = useMe();
  const [mode, setMode] = useState<null | 'enroll' | 'disable' | 'codes'>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  let body;
  if (codes) {
    body = (
      <RecoveryCodes
        codes={codes}
        onDone={() => {
          setCodes(null);
          refresh();
        }}
      />
    );
  } else if (mode === 'enroll') {
    body = (
      <TotpEnroll
        onDone={() => {
          setMode(null);
          refresh();
        }}
        onCancel={() => setMode(null)}
      />
    );
  } else if (mode === 'disable') {
    body = (
      <ConfirmPassword
        label="Turn off"
        danger
        onCancel={() => setMode(null)}
        onConfirm={async (password) => {
          await api.post('/api/auth/totp/disable', { password });
          setMode(null);
          refresh();
        }}
      />
    );
  } else if (mode === 'codes') {
    body = (
      <ConfirmPassword
        label="Make new codes"
        onCancel={() => setMode(null)}
        onConfirm={async (password) => {
          const r = await api.post<{ recoveryCodes: string[] }>('/api/auth/recovery-codes', {
            password,
          });
          setMode(null);
          setCodes(r.recoveryCodes);
        }}
      />
    );
  } else if (user.mfa) {
    body = (
      <div className="row">
        <span className="grow">
          <span className="status-ok">On</span>{' '}
          <span className="hint">
            · {user.recoveryCodesLeft} recovery code{user.recoveryCodesLeft === 1 ? '' : 's'} left
          </span>
        </span>
        <button className="btn small" onClick={() => setMode('codes')}>
          New recovery codes
        </button>
        <button className="btn small danger" onClick={() => setMode('disable')}>
          Turn off
        </button>
      </div>
    );
  } else {
    body = (
      <div className="row">
        <span className="grow">
          <span className="status-error">Off</span>
          {requireMfa && (
            <span className="hint"> · required: you'll set it up at next sign-in</span>
          )}
        </span>
        <button className="btn primary" onClick={() => setMode('enroll')}>
          Set up
        </button>
      </div>
    );
  }

  return (
    <div>
      <h3>Two-step sign-in</h3>
      <p className="hint">
        After your password, also ask for a code from an authenticator app on your phone, so a
        guessed or leaked password isn't enough. Turning it on signs out your other devices.
      </p>
      {user.mfa && mode === null && !codes && requireMfa && (
        <p className="hint">
          Your household requires it: if you turn it off, you'll set it up again next time you sign
          in.
        </p>
      )}
      {body}
    </div>
  );
}

export function AccountCard() {
  const { user } = useMe();
  return (
    <section className="card" id="account">
      <h2>My account</h2>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="grow hint" style={{ margin: 0 }}>
          Signed in as <b>{user.name}</b> ({user.username}) ·{' '}
          {user.role === 'admin' ? 'Admin' : 'Member'}
        </span>
        <button
          type="button"
          className="btn ghost"
          onClick={() => void api.post('/api/auth/logout').then(() => location.assign('/'))}
        >
          Sign out
        </button>
      </div>
      <ChangePassword />
      <TwoStep />
    </section>
  );
}
