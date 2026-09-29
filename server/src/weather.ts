import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PlaceDTO, WeatherDTO } from '@hearthboard/shared';
import type { Auth } from './auth';
import type { DisplayGuard } from './displays';
import { errorMessage, HttpError } from './util';

/** Open-Meteo: free for non-commercial use, no API key. https://open-meteo.com */
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** Every screen showing the same place shares one forecast, refreshed this often. */
const TTL_MS = 15 * 60_000;
/** If Open-Meteo can't be reached, keep showing the last forecast for this long. */
const STALE_MS = 12 * 3600_000;
/** Places remembered at once; a household has a handful, this only bounds memory. */
const MAX_PLACES = 100;

const Forecast = z.object({
  current: z.object({
    temperature_2m: z.number(),
    apparent_temperature: z.number().nullable().optional(),
    weather_code: z.number(),
    is_day: z.number().optional(),
    wind_speed_10m: z.number().nullable().optional(),
    relative_humidity_2m: z.number().nullable().optional(),
  }),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number().nullable()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_probability_max: z.array(z.number().nullable()).optional(),
  }),
});

const Geocode = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        country: z.string().optional(),
        admin1: z.string().optional(),
      }),
    )
    .optional(),
});

export function forecastUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    current:
      'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '8',
  });
  return `${FORECAST_URL}?${q}`;
}

export function parseForecast(json: unknown, fetchedAt: number): WeatherDTO {
  const f = Forecast.parse(json);
  const c = f.current;
  return {
    current: {
      temp: c.temperature_2m,
      feelsLike: c.apparent_temperature ?? c.temperature_2m,
      code: c.weather_code,
      isDay: c.is_day !== 0,
      wind: c.wind_speed_10m ?? 0,
      humidity: c.relative_humidity_2m ?? 0,
    },
    daily: f.daily.time.map((date, i) => ({
      date,
      code: f.daily.weather_code[i] ?? 0,
      max: f.daily.temperature_2m_max[i] ?? c.temperature_2m,
      min: f.daily.temperature_2m_min[i] ?? c.temperature_2m,
      precipChance: f.daily.precipitation_probability_max?.[i] ?? null,
    })),
    fetchedAt,
    stale: false,
  };
}

/** Made-up but plausible weather for demo mode, so the widget works without internet. */
export function demoForecast(now = new Date()): WeatherDTO {
  const codes = [1, 2, 61, 3, 0, 80, 2, 1];
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    current: { temp: 21, feelsLike: 20, code: 2, isDay: true, wind: 12, humidity: 55 },
    daily: codes.map((code, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      return {
        date: ymd(d),
        code,
        max: 24 - (i % 3) * 2,
        min: 13 - (i % 2),
        precipChance: [61, 80].includes(code) ? 70 : 10,
      };
    }),
    fetchedAt: now.getTime(),
    stale: false,
  };
}

export class Weather {
  private cache = new Map<string, { at: number; data: WeatherDTO }>();
  private inflight = new Map<string, Promise<WeatherDTO>>();
  private fetchFn: typeof fetch;

  constructor(private opts: { fetch?: typeof fetch; demo?: boolean } = {}) {
    this.fetchFn = opts.fetch ?? fetch;
  }

  private async getJson(url: string): Promise<unknown> {
    const res = await this.fetchFn(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Open-Meteo answered HTTP ${res.status}`);
    return res.json();
  }

  /** Forecast for a place, shared between screens and cached for 15 minutes. */
  async forecast(lat: number, lon: number, now = Date.now()): Promise<WeatherDTO> {
    if (this.opts.demo) return demoForecast(new Date(now));
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const hit = this.cache.get(key);
    if (hit && now - hit.at < TTL_MS) return hit.data;
    let run = this.inflight.get(key);
    if (!run) {
      run = this.getJson(forecastUrl(lat, lon))
        .then((json) => {
          const data = parseForecast(json, now);
          this.cache.delete(key);
          this.cache.set(key, { at: now, data });
          // Maps keep insertion order: drop the least recently fetched place.
          if (this.cache.size > MAX_PLACES) this.cache.delete(this.cache.keys().next().value!);
          return data;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, run);
    }
    try {
      return await run;
    } catch (err) {
      // The internet is down or Open-Meteo is busy: keep showing what we had.
      if (hit && now - hit.at < STALE_MS) return { ...hit.data, stale: true };
      throw new HttpError(502, `Weather is unavailable right now (${errorMessage(err)}).`);
    }
  }

  /** Look a place up by name, for the widget's settings. */
  async places(query: string): Promise<PlaceDTO[]> {
    const q = new URLSearchParams({
      name: query.trim(),
      count: '8',
      language: 'en',
      format: 'json',
    });
    let json: unknown;
    try {
      json = await this.getJson(`${GEOCODE_URL}?${q}`);
    } catch (err) {
      // Demo mode works offline: pretend the place exists.
      if (this.opts.demo)
        return [{ name: query.trim(), region: 'Demo place', latitude: 40.71, longitude: -74.01 }];
      throw new HttpError(502, `Couldn't look that place up (${errorMessage(err)}).`);
    }
    return (Geocode.parse(json).results ?? []).map((r) => ({
      name: r.name,
      region: [r.admin1, r.country].filter(Boolean).join(', '),
      latitude: r.latitude,
      longitude: r.longitude,
    }));
  }

  register(app: FastifyInstance, auth: Auth, display: DisplayGuard) {
    const Coords = z.object({
      lat: z.coerce.number().min(-90).max(90),
      lon: z.coerce.number().min(-180).max(180),
    });
    app.get('/api/weather', { preHandler: display }, async (req) => {
      const { lat, lon } = Coords.parse(req.query);
      return this.forecast(lat, lon);
    });

    app.get('/api/weather/places', { preHandler: auth.guard }, async (req) => {
      const { q } = z.object({ q: z.string().trim().min(2).max(100) }).parse(req.query);
      return this.places(q);
    });
  }
}
