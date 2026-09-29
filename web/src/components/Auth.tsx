import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import {
  MIN_PASSWORD_LENGTH,
  type AuthStatus,
  type SystemSettingsDTO,
  type UserDTO,
} from '@hearthboard/shared';
import { api } from '../api';
import { useAction } from './Card';
import { CodeInput, TotpEnroll } from './TwoStep';

/** On first setup, start from this device's time zone instead of the image's UTC default. */
async function adoptDeviceTimeZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const current = await api.get<SystemSettingsDTO>('/api/system');
  if (zone && current.timeZone === 'UTC' && zone !== 'UTC')
    await api.put('/api/system', { timeZone: zone });
}

const SIGNED_OUT: AuthStatus = {
  setupNeeded: false,
  authenticated: false,
  stage: null,
  user: null,
  requireMfa: false,
  legacyPin: false,
};

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const refresh = useCallback(() => {
    api.get<AuthStatus>('/api/auth/status').then(setStatus, () => setStatus(SIGNED_OUT));
  }, []);
  useEffect(() => {
    refresh();
    const onUnauthorized = () => refresh();
    window.addEventListener('hb:unauthorized', onUnauthorized);
    return () => window.removeEventListener('hb:unauthorized', onUnauthorized);
  }, [refresh]);
  return { status, refresh };
}

interface Me {
  user: UserDTO;
  requireMfa: boolean;
  /** Re-read the signed-in user, e.g. after changing their two-step sign-in. */
  refresh: () => void;
}

const MeContext = createContext<Me | null>(null);

/** The signed-in user. Only inside <RequireAuth>. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe() outside <RequireAuth>');
  return me;
}

function Shell({ title, hint, children }: { title: string; hint: ReactNode; children: ReactNode }) {
  return (
    <div className="login">
      <div className="login-card card">
        <img src="/favicon.svg" alt="" />
        <h2 style={{ margin: '10px 0 4px' }}>{title}</h2>
        <p className="hint">{hint}</p>
        {children}
        <p className="hint" style={{ marginTop: 14 }}>
          <a href="/">Back to the board</a>
        </p>
      </div>
    </div>
  );
}

function Field({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...input} />
    </label>
  );
}

/** First visit: create the first admin. */
function Setup({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: '', username: '', password: '', confirm: '' });
  const { busy, error, run, setError } = useAction();
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  return (
    <Shell
      title="Welcome to Hearthboard"
      hint="Create your sign-in. You'll be the admin: you can add the rest of the family afterwards, each with their own sign-in and board."
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (form.password !== form.confirm) return setError('The passwords do not match.');
          const { name, username, password } = form;
          const created = await run(() =>
            api.post('/api/auth/setup', { name, username, password }),
          );
          if (!created) return;
          await adoptDeviceTimeZone().catch(() => {});
          onDone();
        }}
      >
        <Field
          label="Your name"
          type="text"
          required
          autoFocus
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <Field
          label="Username"
          type="text"
          required
          autoCapitalize="none"
          autoComplete="username"
          value={form.username}
          onChange={(e) => set({ username: e.target.value.toLowerCase() })}
        />
        <Field
          label={`Password (at least ${MIN_PASSWORD_LENGTH} characters)`}
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => set({ password: e.target.value })}
        />
        <Field
          label="Password again"
          type="password"
          required
          autoComplete="new-password"
          value={form.confirm}
          onChange={(e) => set({ confirm: e.target.value })}
        />
        {error && <div className="error-text">{error}</div>}
        <button className="btn primary" style={{ width: '100%', marginTop: 4 }} disabled={busy}>
          Create account
        </button>
      </form>
    </Shell>
  );
}

function PasswordStep({ legacyPin, onDone }: { legacyPin: boolean; onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Shell title="Sign in" hint="Editing boards and the calendar needs your own sign-in.">
      {legacyPin && (
        <p className="hint notice">
          Hearthboard now has a sign-in for each person. Use the username <b>admin</b> and your old
          PIN as the password, then add everyone else under Settings.
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api.post('/api/auth/login', { username, password }))) onDone();
          else setPassword('');
        }}
      >
        <Field
          label="Username"
          type="text"
          required
          autoFocus
          autoCapitalize="none"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="error-text">{error}</div>}
        <button className="btn primary" style={{ width: '100%', marginTop: 4 }} disabled={busy}>
          Sign in
        </button>
      </form>
    </Shell>
  );
}

function CodeStep({ onDone, onRestart }: { onDone: () => void; onRestart: () => void }) {
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [left, setLeft] = useState<number | null>(null);
  const { busy, error, run } = useAction();

  if (left !== null) {
    return (
      <Shell
        title="Signed in with a recovery code"
        hint={
          <>
            That code is now used up. You have <b>{left}</b> left. If you've lost your phone, turn
            two-step sign-in off and on again in Settings to move it to a new one.
          </>
        }
      >
        <button className="btn primary" style={{ width: '100%' }} onClick={onDone}>
          Continue
        </button>
      </Shell>
    );
  }

  return (
    <Shell
      title="Two-step sign-in"
      hint={
        recovery
          ? 'Enter one of the recovery codes you saved when you set up two-step sign-in.'
          : 'Enter the 6-digit code from your authenticator app.'
      }
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          let result: { usedRecoveryCode: boolean; recoveryCodesLeft: number } | undefined;
          const ok = await run(async () => {
            result = await api.post('/api/auth/mfa', { code });
          });
          if (!ok) setCode('');
          else if (result?.usedRecoveryCode) setLeft(result.recoveryCodesLeft);
          else onDone();
        }}
      >
        {recovery ? (
          <input
            className="pin-input"
            type="text"
            autoFocus
            autoCapitalize="none"
            autoComplete="off"
            aria-label="Recovery code"
            placeholder="xxxxx-xxxxx"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        ) : (
          <CodeInput value={code} onChange={setCode} autoFocus />
        )}
        {error && <div className="error-text">{error}</div>}
        <button
          className="btn primary"
          style={{ width: '100%', marginTop: 14 }}
          disabled={busy || (recovery ? code.trim().length < 10 : code.length !== 6)}
        >
          Verify
        </button>
      </form>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
        <button
          className="btn small ghost"
          onClick={() => {
            setRecovery((r) => !r);
            setCode('');
          }}
        >
          {recovery ? 'Use the app instead' : 'Use a recovery code'}
        </button>
        <button className="btn small ghost" onClick={onRestart}>
          Start over
        </button>
      </div>
    </Shell>
  );
}

function EnrollStep({ onDone, onRestart }: { onDone: () => void; onRestart: () => void }) {
  return (
    <Shell
      title="Set up two-step sign-in"
      hint="Your household requires a code from your phone as well as your password. Set it up once and you're in."
    >
      <div style={{ textAlign: 'left' }}>
        <TotpEnroll onDone={onDone} onCancel={onRestart} />
      </div>
    </Shell>
  );
}

/** Renders children only for a signed-in user; otherwise walks through signing in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, refresh } = useAuth();
  if (!status) return null;
  if (status.authenticated && status.user) {
    return (
      <MeContext.Provider value={{ user: status.user, requireMfa: status.requireMfa, refresh }}>
        {children}
      </MeContext.Provider>
    );
  }
  const restart = () => void api.post('/api/auth/logout').finally(refresh);
  if (status.setupNeeded) return <Setup onDone={refresh} />;
  if (status.stage === 'mfa') return <CodeStep onDone={refresh} onRestart={restart} />;
  if (status.stage === 'enroll') return <EnrollStep onDone={refresh} onRestart={restart} />;
  return <PasswordStep legacyPin={status.legacyPin} onDone={refresh} />;
}
