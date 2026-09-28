import { useEffect, useState } from 'react';
import {
  parseWidgetConfig,
  type CalendarDTO,
  type ChecklistDTO,
  type WidgetInstance,
  type WidgetType,
} from '@hearthboard/shared';
import { api } from '../api';
import { WIDGETS } from '../widgets/registry';
import type { FieldSpec, WidgetDef } from '../widgets/types';

type Config = Record<string, unknown>;

function useOptions<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    api.get<T>(url).then(setData, (e: Error) => setError(e.message));
  }, [url]);
  return { data, error };
}

function MultiChips({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string; color?: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  if (!options.length) return <div className="hint">Nothing to choose from yet.</div>;
  return (
    <div className="chips">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <span
            key={o.id}
            className={`chip ${on ? 'on' : ''}`}
            onClick={() => onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id])}
          >
            {o.color && <span className="dot" style={{ background: o.color }} />}
            {o.label}
          </span>
        );
      })}
    </div>
  );
}

function RemoteField({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const url =
    field.type === 'calendars'
      ? '/api/calendars'
      : field.type === 'reminderLists'
        ? '/api/reminders/lists'
        : field.type === 'checklist'
          ? '/api/checklists'
          : field.type === 'photoFolder'
            ? '/api/photos/folders'
            : field.type === 'album'
              ? '/api/photos/albums'
              : null;
  const { data, error } = useOptions<unknown[]>(url);
  if (error) return <div className="error-text">{error}</div>;
  if (!data) return <div className="hint">Loading…</div>;

  switch (field.type) {
    case 'calendars':
      return (
        <MultiChips
          options={(data as CalendarDTO[])
            .filter((c) => c.enabled)
            .map((c) => ({ id: c.id, label: c.name, color: c.color }))}
          value={(value as string[]) ?? []}
          onChange={onChange}
        />
      );
    case 'reminderLists':
      return (
        <MultiChips
          options={(data as string[]).map((l) => ({ id: l, label: l }))}
          value={(value as string[]) ?? []}
          onChange={onChange}
        />
      );
    case 'checklist':
      return (
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {(data as ChecklistDTO[]).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      );
    case 'photoFolder':
      return (
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">All photos</option>
          {(data as string[]).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      );
    case 'album':
      return (
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose an album…</option>
          {(data as { id: string; name: string; count: number }[]).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.count})
            </option>
          ))}
        </select>
      );
    default:
      return null;
  }
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
    case 'bool':
      return (
        <label className="field inline">
          <span>{field.label}</span>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        </label>
      );
    case 'text':
      return (
        <label className="field">
          <span>{field.label}</span>
          <input
            type="text"
            value={String(value ?? '')}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
    case 'number':
      return (
        <label className="field">
          <span>
            {field.label}
            {field.suffix ? ` (${field.suffix})` : ''}
          </span>
          <input
            type="number"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={Number(value ?? field.min)}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(Math.min(field.max, Math.max(field.min, n)));
            }}
          />
        </label>
      );
    case 'select':
      return (
        <label className="field">
          <span>{field.label}</span>
          <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {field.options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      );
    default:
      return (
        <div className="field">
          <span>{field.label}</span>
          <RemoteField field={field} value={value} onChange={onChange} />
        </div>
      );
  }
}

export function WidgetSettings({
  widget,
  onChange,
  onDelete,
  onDuplicate,
  onClose,
}: {
  widget: WidgetInstance;
  onChange: (config: Config) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onClose: () => void;
}) {
  const def = WIDGETS[widget.type] as unknown as WidgetDef<WidgetType>;
  const config = parseWidgetConfig(widget.type, widget.config) as Config;
  const visible = def.fields.filter((f) => !def.showField || def.showField(f.key, config as never));

  return (
    <div>
      <h2>
        <span>{def.icon}</span> {def.label}
        <span className="spacer" />
        <button className="btn small ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </h2>
      {visible.map((f) => (
        <Field
          key={f.key}
          field={f}
          value={config[f.key]}
          onChange={(v) => onChange({ ...config, [f.key]: v })}
        />
      ))}
      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn" onClick={onDuplicate}>
          Duplicate
        </button>
        <button className="btn danger" onClick={onDelete}>
          Remove widget
        </button>
      </div>
      <p className="hint" style={{ marginTop: 16 }}>
        Drag the pill at the top of a widget to move it; drag its edges or corner to resize.
      </p>
    </div>
  );
}
