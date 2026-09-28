import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';

interface Status {
  authenticated: boolean;
  pinSet: boolean;
}

export function useAuth() {
  const [status, setStatus] = useState<Status | null>(null);
  const refresh = useCallback(() => {
    api
      .get<Status>('/api/auth/status')
      .then(setStatus, () => setStatus({ authenticated: false, pinSet: true }));
  }, []);
  useEffect(() => {
    refresh();
    const onUnauthorized = () => refresh();
    window.addEventListener('hb:unauthorized', onUnauthorized);
    return () => window.removeEventListener('hb:unauthorized', onUnauthorized);
  }, [refresh]);
  return { status, refresh };
}

function Login({ pinSet, onDone }: { pinSet: boolean; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!pinSet && pin !== confirm) return setError('The PINs do not match.');
    setBusy(true);
    try {
      await api.post(pinSet ? '/api/auth/login' : '/api/auth/setup', { pin });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form
        className="login-card card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <img src="/favicon.svg" alt="" />
        <h2 style={{ margin: '10px 0 4px' }}>
          {pinSet ? 'Enter your PIN' : 'Welcome to Hearthboard'}
        </h2>
        <p className="hint">
          {pinSet
            ? 'Editing the board and connecting accounts needs the admin PIN.'
            : 'Choose a 4–12 digit PIN. You will need it to edit the board or connect calendars from any device.'}
        </p>
        <input
          className="pin-input"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder="••••"
        />
        {!pinSet && (
          <input
            className="pin-input"
            style={{ marginTop: 10 }}
            type="password"
            inputMode="numeric"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
            placeholder="again"
          />
        )}
        {error && <div className="error-text">{error}</div>}
        <button
          className="btn primary"
          style={{ width: '100%', marginTop: 14 }}
          disabled={busy || pin.length < 4}
        >
          {pinSet ? 'Unlock' : 'Set PIN'}
        </button>
        <p className="hint" style={{ marginTop: 14 }}>
          <a href="/">Back to the board</a>
        </p>
      </form>
    </div>
  );
}

/** Renders children only once the admin PIN has been entered. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, refresh } = useAuth();
  if (!status) return null;
  if (!status.authenticated) return <Login pinSet={status.pinSet} onDone={refresh} />;
  return <>{children}</>;
}
