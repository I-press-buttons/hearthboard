import {
  formatTemp,
  formatWind,
  resolveUnits,
  weatherInfo,
  type WeatherDTO,
} from '@hearthboard/shared';
import { api, qs } from '../api';
import { useLiveQuery } from '../live';
import type { WidgetProps } from './types';

const weekday = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });

/** Current conditions and a few days of forecast from Open-Meteo, refreshed every 15 minutes. */
export function WeatherWidget({ config, size }: WidgetProps<'weather'>) {
  const { latitude: lat, longitude: lon } = config;
  const hasPlace = lat !== null && lon !== null;
  const { data, error } = useLiveQuery(
    [],
    () =>
      hasPlace ? api.get<WeatherDTO>(`/api/weather${qs({ lat, lon })}`) : Promise.resolve(null),
    [lat, lon],
    15 * 60_000,
  );

  if (!hasPlace) return <div className="widget-empty">Pick a place in this widget's settings.</div>;
  if (!data) return <div className="widget-empty">{error ?? ''}</div>;

  const units = resolveUnits(config.units, navigator.language);
  const t = (c: number) => `${formatTemp(c, units)}°`;
  const now = data.current;
  const info = weatherInfo(now.code, now.isDay);
  const [today, ...later] = data.daily;
  // Leave out the forecast row when the widget is too short to read it.
  const days = size.height > 150 ? later.slice(0, config.days) : [];

  return (
    <div className="weather" title={data.stale ? "Couldn't refresh the forecast" : undefined}>
      <div className="weather-now">
        <span className="weather-icon" aria-hidden>
          {info.icon}
        </span>
        <div className="weather-main">
          <div className="weather-temp">
            {t(now.temp)}
            {data.stale && <span className="weather-stale"> ⚠</span>}
          </div>
          <div className="weather-desc">
            {info.label}
            {today && (
              <span className="weather-range">
                {' '}
                · ↑{t(today.max)} ↓{t(today.min)}
              </span>
            )}
          </div>
          <div className="weather-meta">
            Feels like {t(now.feelsLike)} · {formatWind(now.wind, units)}
            {config.place && ` · ${config.place.split(',')[0]}`}
          </div>
        </div>
      </div>
      {days.length > 0 && (
        <div className="weather-days">
          {days.map((d) => {
            const di = weatherInfo(d.code, true);
            return (
              <div key={d.date} className="weather-day" title={di.label}>
                <div className="weather-day-name">{weekday(d.date)}</div>
                <div className="weather-day-icon" aria-hidden>
                  {di.icon}
                </div>
                <div className="weather-day-temps">
                  {t(d.max)} <span>{t(d.min)}</span>
                </div>
                {/* Always there (hidden when dry) so every day lines up. */}
                <div
                  className="weather-day-rain"
                  style={{ visibility: (d.precipChance ?? 0) >= 30 ? 'visible' : 'hidden' }}
                >
                  💧{d.precipChance ?? 0}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
