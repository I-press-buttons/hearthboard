import { useEffect, useState } from 'react';
import {
  parseWidgetConfig,
  TEXT_SIZES,
  type CalendarDTO,
  type ChecklistDTO,
  type CountdownEntry,
  type PlaceDTO,
  type TextSizeId,
  type WidgetInstance,
  type WidgetType,
} from '@hearthboard/shared';
import { api, qs } from '../api';
import { useAction } from '../components/Card';
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

/** Search Open-Meteo's place names, or use this device's location. Sets place + coordinates. */
function PlaceField({ config, onChange }: { config: Config; onChange: (v: Config) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PlaceDTO[] | null>(null);
  const { busy, error, run, setError } = useAction();
  const lat = config.latitude as number | null;
  const lon = config.longitude as number | null;
  const search = () =>
    run(async () => setResults(await api.get<PlaceDTO[]>(`/api/weather/places${qs({ q })}`)));
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return (
    <div>
      <div className="hint" style={{ margin: '0 0 8px' }}>
        {lat !== null && lon !== null ? (
          <>
            <b style={{ color: 'var(--text)' }}>{String(config.place || 'Chosen place')}</b> (
            {lat.toFixed(2)}, {lon.toFixed(2)})
          </>
        ) : (
          'No place yet.'
        )}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 2) void search();
        }}
      >
        <input
          className="grow"
          type="text"
          placeholder="Town or city"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn small" disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>
      {results && (
        <div className="place-results">
          {results.length ? (
            results.map((r) => (
              <button
                key={`${r.latitude},${r.longitude}`}
                type="button"
                onClick={() => {
                  const region = r.region.split(',')[0];
                  onChange({
                    ...config,
                    place: region && region !== r.name ? `${r.name}, ${region}` : r.name,
                    latitude: round(r.latitude),
                    longitude: round(r.longitude),
                  });
                  setResults(null);
                  setQ('');
                }}
              >
                {r.name} <span className="hint">{r.region}</span>
              </button>
            ))
          ) : (
            <div className="hint">No places found. Try the nearest town.</div>
          )}
        </div>
      )}
      {window.isSecureContext && 'geolocation' in navigator && (
        <button
          type="button"
          className="btn small ghost"
          style={{ marginTop: 6 }}
          onClick={() =>
            navigator.geolocation.getCurrentPosition(
              (pos) =>
                onChange({
                  ...config,
                  place: 'Home',
                  latitude: round(pos.coords.latitude),
                  longitude: round(pos.coords.longitude),
                }),
              (err) => setError(`Couldn't get this device's location: ${err.message}`),
            )
          }
        >
          📍 Use this device's location
        </button>
      )}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

/** The dates a countdown widget counts down to. */
function CountdownsField({
  value,
  onChange,
}: {
  value: CountdownEntry[];
  onChange: (v: CountdownEntry[]) => void;
}) {
  const set = (i: number, patch: Partial<CountdownEntry>) =>
    onChange(value.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const nextWeek = new Date(Date.now() + 7 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div>
      {value.map((e, i) => (
        <div key={i} className="countdown-edit">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input
              type="text"
              className="emoji-input"
              aria-label="Emoji"
              placeholder="🎉"
              maxLength={16}
              value={e.emoji}
              onChange={(ev) => set(i, { emoji: ev.target.value })}
            />
            <input
              type="text"
              aria-label="What"
              placeholder="What (e.g. Beach trip)"
              maxLength={100}
              value={e.title}
              onChange={(ev) => set(i, { title: ev.target.value })}
            />
            <button
              type="button"
              className="btn small ghost"
              aria-label="Remove date"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
          <div className="row">
            <input
              type="date"
              aria-label="Date"
              style={{ width: 'auto' }}
              value={e.date}
              onChange={(ev) => ev.target.value && set(i, { date: ev.target.value })}
            />
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={e.yearly}
                onChange={(ev) => set(i, { yearly: ev.target.checked })}
              />
              Every year
            </label>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn small"
        onClick={() =>
          onChange([
            ...value,
            {
              title: '',
              emoji: '',
              yearly: false,
              date: `${nextWeek.getFullYear()}-${pad(nextWeek.getMonth() + 1)}-${pad(nextWeek.getDate())}`,
            },
          ])
        }
      >
        + Add a date
      </button>
      <p className="hint" style={{ marginBottom: 0 }}>
        “Every year” is for birthdays and holidays: it counts to the next one.
      </p>
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
    case 'multi':
      return (
        <div className="field">
          <span>{field.label}</span>
          <MultiChips
            options={field.options.map(([id, label]) => ({ id, label }))}
            value={(value as string[]) ?? []}
            onChange={(v) =>
              v.length && onChange(field.options.map(([id]) => id).filter((id) => v.includes(id)))
            }
          />
        </div>
      );
    case 'place':
      return (
        <div className="field">
          <span>{field.label}</span>
          <PlaceField config={value as Config} onChange={onChange} />
        </div>
      );
    case 'countdowns':
      return (
        <div className="field">
          <span>{field.label}</span>
          <CountdownsField value={(value as CountdownEntry[]) ?? []} onChange={onChange} />
        </div>
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
  onTextSize,
  onDelete,
  onDuplicate,
  onClose,
}: {
  widget: WidgetInstance;
  onChange: (config: Config) => void;
  onTextSize: (size: TextSizeId | undefined) => void;
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
      {visible.map((f) =>
        f.type === 'place' ? (
          // The place picker reads and writes several keys at once.
          <Field key={f.key} field={f} value={config} onChange={(v) => onChange(v as Config)} />
        ) : (
          <Field
            key={f.key}
            field={f}
            value={config[f.key]}
            onChange={(v) => onChange({ ...config, [f.key]: v })}
          />
        ),
      )}
      <label className="field">
        <span>Text size</span>
        <select
          value={widget.textSize ?? ''}
          onChange={(e) => onTextSize((e.target.value || undefined) as TextSizeId | undefined)}
        >
          <option value="">Same as board</option>
          {(Object.keys(TEXT_SIZES) as TextSizeId[]).map((id) => (
            <option key={id} value={id}>
              {TEXT_SIZES[id].label}
            </option>
          ))}
        </select>
      </label>
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
