import { useEffect, useState } from 'react';
import { inTimeWindow, scheduledBoardId, type Board } from '@hearthboard/shared';
import { api, setDisplayBoard } from '../api';
import { BoardCanvas } from '../board/BoardCanvas';
import { useLive, useLiveQuery, useLiveStatus } from '../live';
import { WidgetView } from '../widgets/registry';

const SHIFTS = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
];

/** Keep the screen on while `on` (Screen Wake Lock; browsers allow it over HTTPS or on localhost). */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        lock = await navigator.wakeLock.request('screen');
        if (stopped) void lock.release();
      } catch {
        /* not allowed here (plain HTTP, battery saver…): the screen may sleep */
      }
    };
    void acquire();
    // Browsers drop the lock whenever the page is hidden; take it again when it's back.
    document.addEventListener('visibilitychange', acquire);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, [on]);
}

/** A "Full screen" button that appears for a few seconds after a tap or mouse move. */
function FullscreenButton() {
  const [visible, setVisible] = useState(false);
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    if (!document.fullscreenEnabled) return;
    let hide: ReturnType<typeof setTimeout>;
    const show = () => {
      setVisible(true);
      clearTimeout(hide);
      hide = setTimeout(() => setVisible(false), 4000);
    };
    const onChange = () => setFull(!!document.fullscreenElement);
    window.addEventListener('pointerdown', show);
    window.addEventListener('pointermove', show);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      clearTimeout(hide);
      window.removeEventListener('pointerdown', show);
      window.removeEventListener('pointermove', show);
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, []);
  useEffect(() => {
    document.body.classList.toggle('pointer-active', visible);
  }, [visible]);
  if (!visible) return null;
  return (
    <button
      className="display-button"
      onClick={() =>
        void (full ? document.exitFullscreen() : document.documentElement.requestFullscreen())
      }
    >
      {full ? 'Exit full screen' : '⛶ Full screen'}
    </button>
  );
}

/** The wall display: full screen, read-only (unless it's a touch-screen board), updates itself. */
export function Display() {
  const homeId = new URLSearchParams(location.search).get('board') || 'main';
  const { data: home, error } = useLiveQuery(
    ['board'],
    () => api.get<Board>(`/api/boards/${encodeURIComponent(homeId)}`),
    [homeId],
  );
  const connected = useLiveStatus();
  const [now, setNow] = useState(() => new Date());
  const [shift, setShift] = useState(0);

  // Board schedules: at set times this screen shows another board, then comes back.
  const shownId = home ? scheduledBoardId(home, now) : homeId;
  const { data: scheduled } = useLiveQuery(
    ['board'],
    () =>
      shownId === homeId
        ? Promise.resolve(null)
        : api.get<Board>(`/api/boards/${shownId}`).catch(() => null), // deleted: stay home
    [shownId],
  );
  const board = shownId !== homeId && scheduled?.id === shownId ? scheduled : home;

  useEffect(() => {
    setDisplayBoard(board?.id ?? null);
  }, [board?.id]);
  useEffect(() => {
    document.body.classList.toggle('touch-mode', !!board?.interactive);
  }, [board?.interactive]);
  useWakeLock(!!board?.keepAwake);

  useEffect(() => {
    document.body.classList.add('display-page');
    const tick = setInterval(() => setNow(new Date()), 30_000);
    const move = setInterval(() => setShift((s) => (s + 1) % SHIFTS.length), 3 * 60_000);
    // Reload once a night so long-running TV browsers stay fresh and pick up upgrades.
    const reload = setInterval(() => {
      const d = new Date();
      if (d.getHours() === 3 && d.getMinutes() < 2) location.reload();
    }, 60_000);
    return () => {
      document.body.classList.remove('display-page', 'touch-mode', 'pointer-active');
      clearInterval(tick);
      clearInterval(move);
      clearInterval(reload);
      setDisplayBoard(null);
    };
  }, []);

  // After the server restarts (e.g. a container update) load the new app version.
  useLive(['reload'], () => setTimeout(() => location.reload(), 2000));

  if (!board) {
    return (
      <div className="widget-empty" style={{ height: '100%' }}>
        {error ? `Can't reach Hearthboard: ${error}` : 'Loading…'}
      </div>
    );
  }

  const dimmed = board.dim.enabled && inTimeWindow(now, board.dim.start, board.dim.end);

  return (
    <>
      <BoardCanvas
        board={board}
        shift={board.pixelShift ? SHIFTS[shift] : undefined}
        renderWidget={(w, size) => (
          <WidgetView widget={w} size={size} mode="display" board={board} />
        )}
      />
      <div className="dim-overlay" style={{ opacity: dimmed ? 1 - board.dim.level : 0 }} />
      {!connected && <div className="offline-dot" title="Reconnecting…" />}
      <FullscreenButton />
    </>
  );
}
