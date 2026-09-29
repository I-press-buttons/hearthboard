import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalDavProvider } from '../src/calendars/caldav';
import { GoogleProvider } from '../src/calendars/google';
import { SynologyPhotos } from '../src/photos/synology';
import { errorMessage, timedFetch } from '../src/util';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Make every request time out after 50 ms instead of 30 s. */
function shortTimeouts() {
  const real = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => real(50));
}

/** A fetch that never answers, and gives up only when its signal fires (like the real one). */
const stalled = ((_url: string | URL, init: RequestInit = {}) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
  })) as typeof fetch;

describe('timeouts on outside servers', () => {
  it('gives up on a Google server that stalls, in friendly words', async () => {
    shortTimeouts();
    const p = new GoogleProvider({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }, stalled);
    const err = await p.listCalendars().catch((e: unknown) => e);
    expect(errorMessage(err)).toBe('The server took too long to answer.');
  });

  it('puts a timer on every Google call, a new one each time', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const f = (async (url: string | URL, init: RequestInit = {}) => {
      signals.push(init.signal);
      const token = String(url).includes('oauth2');
      return new Response(JSON.stringify(token ? { access_token: 'at', expires_in: 3600 } : {}));
    }) as typeof fetch;
    const p = new GoogleProvider({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }, f);
    await p.listCalendars();
    await p.listCalendars();
    expect(signals).toHaveLength(3); // token, list, list
    for (const s of signals) expect(s).toBeInstanceOf(AbortSignal);
    expect(new Set(signals).size).toBe(3);
  });

  it('puts a timer on every Synology call', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const f = (async (url: string | URL, init: RequestInit = {}) => {
      signals.push(init.signal);
      const login = String(url).includes('method=login');
      return new Response(
        JSON.stringify({ success: true, data: login ? { sid: 'x' } : { list: [] } }),
      );
    }) as typeof fetch;
    const c = new SynologyPhotos({ url: 'https://nas:5001', username: 'u', password: 'p' }, f);
    await c.albums();
    expect(signals).toHaveLength(2); // sign in, list
    for (const s of signals) expect(s).toBeInstanceOf(AbortSignal);
  });

  it('gives the CalDAV client a fresh timer for each request', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      signals.push(init?.signal);
      return new Response('');
    });
    await timedFetch('https://caldav.example/');
    await timedFetch('https://caldav.example/', { method: 'PROPFIND' });
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0]!.aborted).toBe(false);
  });

  it('gives up on a CalDAV server that stalls', async () => {
    shortTimeouts();
    const server = http.createServer(() => {}); // accepts connections, never answers
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const { port } = server.address() as AddressInfo;
      const p = new CalDavProvider({
        serverUrl: `http://127.0.0.1:${port}/`,
        username: 'u',
        password: 'p',
      });
      const err = await p.listCalendars().catch((e: unknown) => e);
      expect(errorMessage(err)).toBe('The server took too long to answer.');
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
