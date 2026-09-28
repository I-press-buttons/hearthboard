import { useState } from 'react';
import type { ChecklistDTO } from '@hearthboard/shared';
import { api } from '../api';
import { useLiveQuery } from '../live';
import type { WidgetProps } from './types';

export function ChecklistWidget({ config, mode, size }: WidgetProps<'checklist'>) {
  const { data, error, reload } = useLiveQuery(
    ['checklists'],
    () =>
      config.checklistId
        ? api.get<ChecklistDTO>(`/api/checklists/${config.checklistId}`)
        : Promise.resolve(null),
    [config.checklistId],
  );
  const [text, setText] = useState('');

  if (!config.checklistId)
    return <div className="widget-empty">Pick a checklist in this widget's settings.</div>;
  if (error && !data) return <div className="widget-empty">{error}</div>;
  if (!data) return null;

  const toggle = (id: string, done: boolean) =>
    api.patch(`/api/checklists/${data.id}/items/${id}`, { done }).then(reload, () => {});
  const add = async () => {
    if (!text.trim()) return;
    await api.post(`/api/checklists/${data.id}/items`, { text: text.trim() });
    setText('');
    reload();
  };

  const items = config.hideDone ? data.items.filter((i) => !i.done) : data.items;
  const left = data.items.filter((i) => !i.done).length;

  return (
    <>
      <div className="widget-title">
        {data.name}
        {data.items.length > 0 && (
          <span style={{ float: 'right' }}>{left ? `${left} left` : 'All done ✓'}</span>
        )}
      </div>
      <div className="widget-body">
        <ul className="list">
          {items.map((i) => (
            <li key={i.id} className={i.done ? 'done' : ''}>
              <button
                className={`check ${i.done ? 'on' : ''}`}
                aria-label={i.done ? 'Mark not done' : 'Mark done'}
                onClick={() => toggle(i.id, !i.done)}
              />
              <span className="item-text">{i.text}</span>
            </li>
          ))}
          {!items.length && <li className="item-meta">Nothing here.</li>}
        </ul>
      </div>
      {mode === 'edit' && size.width > 220 && size.height > 160 && (
        <form
          style={{ padding: '0 0.8em 0.8em', fontSize: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            type="text"
            value={text}
            placeholder="Add item…"
            onChange={(e) => setText(e.target.value)}
          />
        </form>
      )}
    </>
  );
}
