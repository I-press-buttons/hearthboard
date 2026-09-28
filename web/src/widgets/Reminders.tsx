import type { ReminderDTO } from '@hearthboard/shared';
import { api, qs } from '../api';
import { useLiveQuery } from '../live';
import type { WidgetProps } from './types';

export function formatDue(due: string, now = new Date()): { text: string; overdue: boolean } {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(due);
  const d = dateOnly ? new Date(due + 'T00:00:00') : new Date(due);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  const time = dateOnly
    ? ''
    : ` ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  const overdue = dateOnly ? days < 0 : d.getTime() < now.getTime();
  let label: string;
  if (days === 0) label = 'Today';
  else if (days === 1) label = 'Tomorrow';
  else if (days === -1) label = 'Yesterday';
  else if (days > 1 && days < 7) label = d.toLocaleDateString(undefined, { weekday: 'long' });
  else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { text: label + time, overdue };
}

export function RemindersWidget({ config }: WidgetProps<'reminders'>) {
  const lists = config.lists.join(',');
  const { data, reload } = useLiveQuery(
    ['reminders'],
    () => api.get<ReminderDTO[]>(`/api/reminders${qs({ lists })}`),
    [lists],
    5 * 60_000,
  );

  const toggle = (r: ReminderDTO) =>
    api
      .post(`/api/reminders/${r.id}/complete`, { done: !r.pendingComplete })
      .then(reload, () => {});

  const items = (data ?? []).slice(0, config.maxItems);
  const showList = config.lists.length !== 1;

  return (
    <>
      <div className="widget-title">{config.title}</div>
      <div className="widget-body">
        {data && !data.length ? (
          <div className="widget-empty">No reminders. Nice!</div>
        ) : (
          <ul className="list">
            {items.map((r) => {
              const due = r.due && config.showDue ? formatDue(r.due) : null;
              return (
                <li key={r.id} className={r.pendingComplete ? 'done' : ''}>
                  <button
                    className={`check ${r.pendingComplete ? 'on' : ''}`}
                    title={r.pendingComplete ? 'Waiting for your iPhone to sync' : 'Complete'}
                    onClick={() => toggle(r)}
                  />
                  <div>
                    <div className="item-text">
                      {r.flagged && <span style={{ color: 'var(--accent)' }}>⚑ </span>}
                      {r.title}
                    </div>
                    {(due || showList) && (
                      <div className={`item-meta ${due?.overdue ? 'overdue' : ''}`}>
                        {[due?.text, showList ? r.list : null].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
