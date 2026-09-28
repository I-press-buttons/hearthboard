import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { LiveMessage, LiveTopic } from '@hearthboard/shared';

type Listener = (msg: LiveMessage) => void;

/** Single reconnecting WebSocket shared by the whole page. */
class LiveClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<() => void>();
  private retry = 0;
  connected = false;

  start() {
    if (this.ws) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      const wasReconnect = this.retry > 0;
      this.retry = 0;
      this.setConnected(true);
      // Anything may have changed while we were away.
      if (wasReconnect) this.emit({ topic: 'reload' });
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as LiveMessage | { topic: 'ping' };
        if (msg.topic !== 'ping') this.emit(msg as LiveMessage);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.setConnected(false);
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.start(), delay);
    };
  }

  private setConnected(v: boolean) {
    this.connected = v;
    for (const l of this.statusListeners) l();
  }

  private emit(msg: LiveMessage) {
    for (const l of this.listeners) l(msg);
  }

  on(listener: Listener): () => void {
    this.start();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus = (cb: () => void) => {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  };
}

export const live = new LiveClient();

export function useLiveStatus(): boolean {
  return useSyncExternalStore(live.onStatus, () => live.connected);
}

/** Call `cb` whenever one of `topics` changes (or after a reconnect). */
export function useLive(topics: LiveTopic[], cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  const key = topics.join(',');
  useEffect(() => {
    const set = new Set(key.split(','));
    return live.on((msg) => {
      if (msg.topic === 'reload' || set.has(msg.topic)) ref.current();
    });
  }, [key]);
}

/**
 * Fetch data, refetching when a live topic fires and optionally on an interval.
 * Keeps showing the last good value while refetching.
 */
export function useLiveQuery<T>(
  topics: LiveTopic[],
  fetcher: () => Promise<T>,
  deps: unknown[],
  refreshMs?: number,
): { data: T | undefined; error: string | null; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const seq = useRef(0);

  const reload = useRef(() => {
    const n = ++seq.current;
    fetchRef
      .current()
      .then((d) => {
        if (n === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (n === seq.current) setError(e.message);
      });
  }).current;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  useLive(topics, reload);
  useEffect(() => {
    if (!refreshMs) return;
    const t = setInterval(reload, refreshMs);
    return () => clearInterval(t);
  }, [refreshMs, reload]);

  return { data, error, reload };
}
