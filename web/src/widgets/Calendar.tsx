import type { EventDTO } from '@hearthboard/shared';
import { useLiveQuery } from '../live';
import { CalendarView, fetchEvents } from './CalendarView';
import type { WidgetProps } from './types';

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Big-type list of the next few days: the most readable view from across a room. */
function Agenda({ days, calendarIds }: { days: number; calendarIds: string[] }) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  const idsKey = calendarIds.join(',');
  const { data } = useLiveQuery(
    ['events', 'calendars'],
    () => fetchEvents(start, end, calendarIds),
    [idsKey, days, dayKey(start)],
    10 * 60_000,
  );

  const groups: { key: string; date: Date; events: EventDTO[] }[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    groups.push({ key: dayKey(date), date, events: [] });
  }
  for (const e of data ?? []) {
    for (const g of groups) {
      const dayStart = g.date.getTime();
      const dayEnd = dayStart + 86_400_000;
      const s = e.allDay ? new Date(e.start + 'T00:00:00').getTime() : Date.parse(e.start);
      const en = e.allDay ? new Date(e.end + 'T00:00:00').getTime() : Date.parse(e.end);
      if (s < dayEnd && Math.max(en, s + 1) > dayStart) g.events.push(e);
    }
  }
  for (const g of groups)
    g.events.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));

  const label = (d: Date, i: number) =>
    i === 0
      ? 'Today'
      : i === 1
        ? 'Tomorrow'
        : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <div className="agenda">
      {groups
        .filter((g, i) => i === 0 || g.events.length)
        .map((g) => {
          const i = groups.indexOf(g);
          return (
            <div key={g.key} className={`agenda-day ${i === 0 ? 'today' : ''}`}>
              <h3>{label(g.date, i)}</h3>
              {!g.events.length && <div className="item-meta">Nothing planned</div>}
              {g.events.map((e) => (
                <div key={e.id} className="agenda-event">
                  <span className="bar" style={{ background: e.color }} />
                  <span className="time">
                    {e.allDay
                      ? 'All day'
                      : new Date(e.start).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                  </span>
                  <span>
                    {e.title}
                    {e.location && <span className="item-meta"> · {e.location}</span>}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
    </div>
  );
}

export function CalendarWidget({ config }: WidgetProps<'calendar'>) {
  return (
    <div className="cal">
      {config.view === 'agenda' ? (
        <>
          {config.title && (
            <div className="widget-title" style={{ padding: '0.3em 0.4em' }}>
              {config.title}
            </div>
          )}
          <Agenda days={config.agendaDays} calendarIds={config.calendarIds} />
        </>
      ) : (
        <CalendarView
          view={config.view}
          calendarIds={config.calendarIds}
          showWeekends={config.showWeekends}
        />
      )}
    </div>
  );
}
