import { useEffect, useState } from 'react';
import { inTimeWindow, type Board } from '@hearthboard/shared';
import { api } from '../api';
import { BoardCanvas } from '../board/BoardCanvas';
import { useLive, useLiveQuery, useLiveStatus } from '../live';
import { WidgetView } from '../widgets/registry';

const SHIFTS = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
];

/** The wall display: full screen, read-only, updates itself. */
export function Display() {
  const boardId = new URLSearchParams(location.search).get('board') || 'main';
  const { data: board, error } = useLiveQuery(
    ['board'],
    () => api.get<Board>(`/api/boards/${boardId}`),
    [boardId],
  );
  const connected = useLiveStatus();
  const [now, setNow] = useState(() => new Date());
  const [shift, setShift] = useState(0);

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
      document.body.classList.remove('display-page');
      clearInterval(tick);
      clearInterval(move);
      clearInterval(reload);
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
    </>
  );
}
