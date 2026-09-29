import { useState } from 'react';
import type { TotpSetup } from '@hearthboard/shared';
import { api } from '../api';
import { useAction } from './Card';

/** A 6-digit authenticator code field. */
export function CodeInput({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <input
      className="pin-input"
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      aria-label="6-digit code"
      maxLength={6}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      placeholder="000000"
    />
  );
}

/** Shown once: the codes that sign you in if your phone is lost. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n') + '\n';
  return (
    <div>
      <p className="hint">
        Save these recovery codes somewhere safe, such as a password manager or a printout in a
        drawer. If you lose your phone, each one signs you in once.{' '}
        <b>They won't be shown again.</b>
      </p>
      <div className="recovery-codes">
        {codes.map((c) => (
          <code key={c}>{c}</code>
        ))}
      </div>
      <div className="row">
        {/* The clipboard API only exists on https or localhost. */}
        {navigator.clipboard && (
          <button
            type="button"
            className="btn"
            onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
        <a
          className="btn"
          download="hearthboard-recovery-codes.txt"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
        >
          Download
        </a>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={onDone}>
          I saved them
        </button>
      </div>
    </div>
  );
}

/** Pair an authenticator app: scan a QR code, confirm with a code, then save recovery codes. */
export function TotpEnroll({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const { busy, error, run } = useAction();

  if (recoveryCodes) return <RecoveryCodes codes={recoveryCodes} onDone={onDone} />;

  if (!setup) {
    return (
      <div>
        <p className="hint">
          You'll need an authenticator app on your phone: the iPhone's Passwords app, Google
          Authenticator, Microsoft Authenticator, 1Password or similar.
        </p>
        {error && <div className="error-text">{error}</div>}
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() =>
              void run(async () => setSetup(await api.post<TotpSetup>('/api/auth/totp/setup')))
            }
          >
            Set up two-step sign-in
          </button>
          {onCancel && (
            <button type="button" className="btn ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const r = await api.post<{ recoveryCodes: string[] }>('/api/auth/totp/enable', { code });
          setRecoveryCodes(r.recoveryCodes);
        }).then((ok) => ok || setCode(''));
      }}
    >
      <p className="hint">1. In your authenticator app, add an account and scan this code.</p>
      <img
        className="qr"
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`}
        alt="QR code for your authenticator app"
      />
      <details className="hint">
        <summary>Can't scan it?</summary>
        <p>
          On this phone, <a href={setup.uri}>open it in your authenticator app</a>. Or type in this
          key: <code>{setup.secret.match(/.{1,4}/g)!.join(' ')}</code>
        </p>
      </details>
      <p className="hint">2. Enter the 6-digit code the app shows.</p>
      <CodeInput value={code} onChange={setCode} autoFocus />
      {error && <div className="error-text">{error}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <span className="spacer" />
        <button className="btn primary" disabled={busy || code.length !== 6}>
          Turn on
        </button>
      </div>
    </form>
  );
}
