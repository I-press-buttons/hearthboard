import { useEffect, useState } from 'react';
import {
  countdownLabel,
  stripKeyword,
  upcomingCountdowns,
  type CountdownEntry,
  type EventDTO,
} from '@hearthboard/shared';
import { useLiveQuery } from '../live';
import { fetchEvents } from './CalendarView';
import type { WidgetProps } from './types';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Calendar events whose title has the keyword, one entry per event (not per repeat). */
export function keywordEntries(events: EventDTO[], keyword: string): CountdownEntry[] {
  if (!keyword) return [];
  const k = keyword.toLowerCase();
  const seen = new Set<string>();
  const out: CountdownEntry[] = [];
  for (const e of events) {
    if (!e.title.toLowerCase().includes(k) || seen.has(e.resourceId)) continue;
    seen.add(e.resourceId);
    out.push({
      title: stripKeyword(e.title, keyword),
      date: e.allDay ? e.start.slice(0, 10) : ymd(new Date(e.start)),
      emoji: '',
      yearly: false,
    });
  }
  return out;
}

/** "12 sleeps until the beach": dates typed into the widget, plus tagged calendar events. */
export function CountdownWidget({ config }: WidgetProps<'countdown'>) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const today = ymd(now);

  const { data: events } = useLiveQuery(
    ['events', 'calendars'],
    () => {
      if (!config.keyword) return Promise.resolve([] as EventDTO[]);
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return fetchEvents(start, new Date(start.getTime() + 365 * 86_400_000));
    },
    [config.keyword, today],
    30 * 60_000,
  );

  const items = upcomingCountdowns(
    [...config.entries, ...keywordEntries(events ?? [], config.keyword)],
    now,
  ).slice(0, config.maxItems);

  return (
    <>
      {config.title && <div className="widget-title">{config.title}</div>}
      <div className="widget-body">
        {!items.length ? (
          <div className="widget-empty">
            Nothing to count down to. Add dates in this widget's settings.
          </div>
        ) : (
          <ul className="list countdown">
            {items.map((c, i) => (
              <li key={`${c.title}-${c.date}-${i}`} className={c.days === 0 ? 'is-today' : ''}>
                <div className="countdown-num" title={countdownLabel(c.days, config.unit)}>
                  {c.days === 0 ? '🎉' : c.days}
                  {c.days > 0 && (
                    <span className="countdown-unit">
                      {config.unit === 'sleeps'
                        ? c.days === 1
                          ? 'sleep'
                          : 'sleeps'
                        : c.days === 1
                          ? 'day'
                          : 'days'}
                    </span>
                  )}
                </div>
                <div>
                  <div className="item-text">
                    {c.emoji && <span>{c.emoji} </span>}
                    {c.title || 'Untitled'}
                  </div>
                  <div className="item-meta">
                    {c.days === 0
                      ? 'Today!'
                      : new Date(`${c.date}T12:00:00`).toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
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
