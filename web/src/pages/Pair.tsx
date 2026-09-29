import { useEffect, useRef, useState } from 'react';
import type { DisplayStatus } from '@hearthboard/shared';
import { api } from '../api';

/** How often a waiting screen checks whether an admin has entered its code. */
const POLL_MS = 3000;

/**
 * Shown on a screen that isn't paired yet, instead of the board. It shows a code for an admin to
 * enter under Settings → Displays, and carries on by itself once they have.
 */
export function PairScreen({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = async () => {
      try {
        const status = await api.get<DisplayStatus>('/api/displays/me');
        if (stopped) return;
        if (status.allowed) return onPaired();
        // No code yet, or the last one ran out: ask for one.
        const pending = status.pending ?? (await api.post<{ code: string }>('/api/displays/pair'));
        if (stopped) return;
        setCode(pending.code);
        setProblem(null);
      } catch (e) {
        if (!stopped) setProblem((e as Error).message);
      }
      if (!stopped) timer = setTimeout(step, POLL_MS);
    };
    void step();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [onPaired]);

  return (
    <div className="pair-screen">
      <img src="/favicon.svg" alt="" />
      <h1>Pair this screen</h1>
      <p>
        On a phone or computer, open <b>{location.host}/settings</b>, sign in, and enter this code
        under <b>Displays</b>.
      </p>
      <div className="pair-code" aria-live="polite">
        {code ?? '····-····'}
      </div>
      <p className="pair-note">
        {problem ??
          'The board appears here as soon as it is paired. The code changes now and then.'}
      </p>
      <a className="pair-link" href="/edit">
        Signing in with a password instead?
      </a>
    </div>
  );
}

/**
 * A pairing link from Settings → Displays. The secret is in the #fragment, so it never reaches
 * a server log; it is traded for the display cookie here and dropped from the address bar.
 */
export function PairLink() {
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(location.hash.slice(1)).get('token');
    history.replaceState(null, '', location.pathname);
    if (!token) return setProblem('This pairing link is not complete. Ask an admin for a new one.');
    api.post('/api/displays/claim', { token }).then(
      () => location.replace('/'),
      (e: Error) => setProblem(e.message),
    );
  }, []);

  return (
    <div className="login">
      <div className="login-card card">
        <img src="/favicon.svg" alt="" />
        <h2 style={{ margin: '10px 0 4px' }}>
          {problem ? "Couldn't pair this screen" : 'Pairing…'}
        </h2>
        {problem && (
          <>
            <p className="hint">{problem}</p>
            <p className="hint" style={{ marginTop: 14 }}>
              <a href="/">Back to the board</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
