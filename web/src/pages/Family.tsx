import { useState } from 'react';
import {
  NOTE_COLOR_IDS,
  NOTE_COLORS,
  NOTE_EXPIRY_CHOICES,
  type MealDTO,
  type MealSlot,
  type NoteColor,
  type NoteDTO,
} from '@hearthboard/shared';
import { api, qs } from '../api';
import { useMe } from '../components/Auth';
import { Card, useAction } from '../components/Card';
import { TopBar } from '../components/TopBar';
import { useLiveQuery } from '../live';
import { SLOT_LABELS, ymd } from '../widgets/Meals';
import { timeAgo } from '../widgets/Notes';

// ---------------- notes ----------------

function NotesCard() {
  const { user } = useMe();
  const { data, reload } = useLiveQuery(['notes'], () => api.get<NoteDTO[]>('/api/notes'), []);
  const [text, setText] = useState('');
  const [color, setColor] = useState<NoteColor>('yellow');
  const [hours, setHours] = useState<number | null>(24);
  const { busy, error, run } = useAction();

  const post = () =>
    run(async () => {
      await api.post('/api/notes', { text, color, expiresInHours: hours });
      setText('');
      reload();
    });

  return (
    <Card
      title="Notes for the family"
      hint="Post a note from your phone and it shows on every board with a Family notes widget. It comes down by itself when it expires."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void post();
        }}
      >
        <label className="field">
          <span>Note</span>
          <textarea
            rows={2}
            maxLength={280}
            placeholder="e.g. Soccer is cancelled today!"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="swatches" role="radiogroup" aria-label="Color">
            {NOTE_COLOR_IDS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === color}
                aria-label={c}
                className={`swatch ${c === color ? 'on' : ''}`}
                style={{ background: NOTE_COLORS[c] }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <label className="row grow" style={{ gap: 8, fontSize: 14 }}>
            <span className="hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>
              Take it down after
            </span>
            <select
              value={hours === null ? '' : String(hours)}
              onChange={(e) => setHours(e.target.value ? Number(e.target.value) : null)}
            >
              {NOTE_EXPIRY_CHOICES.map(([h, label]) => (
                <option key={label} value={h === null ? '' : String(h)}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <div className="error-text">{error}</div>}
        <button className="btn primary" disabled={busy || !text.trim()}>
          {busy ? 'Posting…' : 'Post note'}
        </button>
      </form>
      {(data ?? []).length > 0 && <h3>On the board now</h3>}
      {(data ?? []).map((n) => (
        <div key={n.id} className="table-row">
          <span className="dot" style={{ background: NOTE_COLORS[n.color] }} />
          <span style={{ flex: 1 }}>
            {n.text}
            <span className="hint" style={{ display: 'block', margin: 0 }}>
              {n.author} · {timeAgo(n.createdAt)}
              {n.expiresAt
                ? ` · until ${new Date(n.expiresAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
                : ''}
            </span>
          </span>
          {(user.role === 'admin' || n.authorId === user.id) && (
            <button
              className="btn small"
              onClick={() => void run(() => api.del(`/api/notes/${n.id}`)).then(reload)}
            >
              Take down
            </button>
          )}
        </div>
      ))}
    </Card>
  );
}

// ---------------- meal plan ----------------

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

function startOfWeek(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
}

function MealPlanCard() {
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const startKey = ymd(week);
  const { data, reload } = useLiveQuery(
    ['meals'],
    () => api.get<MealDTO[]>(`/api/meals${qs({ start: startKey, days: 7 })}`),
    [startKey],
  );
  const hasOtherMeals = (data ?? []).some((m) => m.slot !== 'dinner');
  const [allSlots, setAllSlots] = useState(false);
  const slots = allSlots || hasOtherMeals ? SLOTS : (['dinner'] as MealSlot[]);
  const { error, run } = useAction();
  const [saved, setSaved] = useState<string | null>(null);

  const byKey = new Map((data ?? []).map((m) => [`${m.date}|${m.slot}`, m.text]));
  const days = Array.from(
    { length: 7 },
    (_, i) => new Date(week.getFullYear(), week.getMonth(), week.getDate() + i),
  );
  const todayKey = ymd(new Date());
  const shift = (n: number) =>
    setWeek(new Date(week.getFullYear(), week.getMonth(), week.getDate() + n * 7));

  const save = (date: string, slot: MealSlot, text: string) => {
    if ((byKey.get(`${date}|${slot}`) ?? '') === text.trim()) return;
    void run(async () => {
      await api.put(`/api/meals/${date}/${slot}`, { text });
      setSaved(`${date}|${slot}`);
      reload();
    });
  };

  /** Fill this week's empty meals with last week's. */
  const repeatLastWeek = () =>
    run(async () => {
      const prevStart = ymd(new Date(week.getFullYear(), week.getMonth(), week.getDate() - 7));
      const prev = await api.get<MealDTO[]>(`/api/meals${qs({ start: prevStart, days: 7 })}`);
      for (const m of prev) {
        const d = new Date(`${m.date}T12:00:00`);
        const date = ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7));
        if (!byKey.get(`${date}|${m.slot}`))
          await api.put(`/api/meals/${date}/${m.slot}`, { text: m.text });
      }
      reload();
    });

  return (
    <Card
      title="Meal plan"
      hint="What's for dinner, all week. Add a Meal plan widget to a board to show it. Changes save as soon as you leave a box."
    >
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn small" onClick={() => shift(-1)} aria-label="Previous week">
          ‹
        </button>
        <b style={{ minWidth: 140, textAlign: 'center' }}>
          Week of {week.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </b>
        <button className="btn small" onClick={() => shift(1)} aria-label="Next week">
          ›
        </button>
        {ymd(startOfWeek(new Date())) !== startKey && (
          <button className="btn small ghost" onClick={() => setWeek(startOfWeek(new Date()))}>
            This week
          </button>
        )}
        <span className="spacer" />
        {!hasOtherMeals && (
          <label className="row" style={{ gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={allSlots}
              onChange={(e) => setAllSlots(e.target.checked)}
            />
            Breakfast & lunch too
          </label>
        )}
      </div>
      {days.map((d) => {
        const date = ymd(d);
        return (
          <div key={date} className={`meal-row ${date === todayKey ? 'is-today' : ''}`}>
            <div className="meal-day">
              {d.toLocaleDateString(undefined, { weekday: 'short' })}
              <span className="hint" style={{ margin: 0 }}>
                {' '}
                {d.getDate()}
              </span>
            </div>
            <div className="meal-inputs">
              {slots.map((slot) => {
                const current = byKey.get(`${date}|${slot}`) ?? '';
                return (
                  <label key={slot} className="meal-input">
                    {slots.length > 1 && (
                      <span title={SLOT_LABELS[slot].label}>{SLOT_LABELS[slot].icon}</span>
                    )}
                    <input
                      // Re-mount when the saved value changes (e.g. edited on another phone).
                      key={current}
                      type="text"
                      maxLength={200}
                      aria-label={`${SLOT_LABELS[slot].label} on ${d.toLocaleDateString(undefined, { weekday: 'long' })}`}
                      placeholder={SLOT_LABELS[slot].label}
                      defaultValue={current}
                      onBlur={(e) => save(date, slot, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                    {saved === `${date}|${slot}` && <span className="status-ok">✓</span>}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      {error && <div className="error-text">{error}</div>}
      <button className="btn small" style={{ marginTop: 10 }} onClick={() => void repeatLastWeek()}>
        Fill empty days from last week
      </button>
    </Card>
  );
}

/** Day-to-day family things, made for a phone: notes for the board and the meal plan. */
export function Family() {
  return (
    <div className="app">
      <TopBar active="family" />
      <div className="page">
        <div className="page-inner">
          <NotesCard />
          <MealPlanCard />
        </div>
      </div>
    </div>
  );
}
