import { useEffect, useState } from 'react';
import { NOTE_COLORS, type NoteDTO } from '@hearthboard/shared';
import { api } from '../api';
import { useLiveQuery } from '../live';
import type { WidgetProps } from './types';

export function timeAgo(ts: number, now = Date.now()): string {
  const m = Math.round((now - ts) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Sticky notes the family posts from their phones (Family page). */
export function NotesWidget({ config }: WidgetProps<'notes'>) {
  const { data } = useLiveQuery(['notes'], () => api.get<NoteDTO[]>('/api/notes'), [], 5 * 60_000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const notes = (data ?? [])
    .filter((n) => !n.expiresAt || n.expiresAt > now)
    .slice(0, config.maxItems);

  return (
    <>
      {config.title && <div className="widget-title">{config.title}</div>}
      <div className="widget-body">
        {data && !notes.length ? (
          <div className="widget-empty">No notes. Post one from the Family page on your phone.</div>
        ) : config.style === 'sticky' ? (
          <div className="notes-grid">
            {notes.map((n, i) => (
              <div
                key={n.id}
                className="sticky-note"
                style={{
                  background: NOTE_COLORS[n.color],
                  rotate: `${[-1.5, 1, -0.5, 1.5][i % 4]}deg`,
                }}
              >
                <div className="sticky-text">{n.text}</div>
                <div className="sticky-meta">
                  {n.author} · {timeAgo(n.createdAt, now)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ul className="list">
            {notes.map((n) => (
              <li key={n.id}>
                <span
                  className="dot"
                  style={{ background: NOTE_COLORS[n.color], marginTop: '0.35em' }}
                />
                <div>
                  <div className="item-text">{n.text}</div>
                  <div className="item-meta">
                    {n.author} · {timeAgo(n.createdAt, now)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
