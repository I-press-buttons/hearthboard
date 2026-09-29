import { useEffect, useState } from 'react';
import type { MealDTO, MealSlot } from '@hearthboard/shared';
import { api, qs } from '../api';
import { useLiveQuery } from '../live';
import type { WidgetProps } from './types';

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const SLOT_LABELS: Record<MealSlot, { label: string; icon: string }> = {
  breakfast: { label: 'Breakfast', icon: '🍳' },
  lunch: { label: 'Lunch', icon: '🥪' },
  dinner: { label: 'Dinner', icon: '🍽️' },
};

/** The week's meals, planned on the Family page. */
export function MealsWidget({ config }: WidgetProps<'meals'>) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start =
    config.startOn === 'week'
      ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay())
      : today;
  const startKey = ymd(start);
  const { data } = useLiveQuery(
    ['meals'],
    () => api.get<MealDTO[]>(`/api/meals${qs({ start: startKey, days: config.days })}`),
    [startKey, config.days],
    30 * 60_000,
  );

  const byKey = new Map((data ?? []).map((m) => [`${m.date}|${m.slot}`, m.text]));
  const slots = (['breakfast', 'lunch', 'dinner'] as const).filter((s) => config.slots.includes(s));
  const days = Array.from({ length: config.days }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { d, key: ymd(d) };
  });
  const todayKey = ymd(today);

  return (
    <>
      {config.title && <div className="widget-title">{config.title}</div>}
      <div className="widget-body">
        <ul className="list meals">
          {days.map(({ d, key }) => (
            <li
              key={key}
              className={key === todayKey ? 'is-today' : key < todayKey ? 'is-past' : ''}
            >
              <div className="meals-day">
                {key === todayKey ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })}
              </div>
              <div className="meals-food">
                {slots.map((s) => {
                  const text = byKey.get(`${key}|${s}`);
                  return (
                    <div key={s} className={text ? '' : 'meals-empty'}>
                      {slots.length > 1 && (
                        <span className="meals-slot" title={SLOT_LABELS[s].label}>
                          {SLOT_LABELS[s].icon}{' '}
                        </span>
                      )}
                      {text ?? '—'}
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
