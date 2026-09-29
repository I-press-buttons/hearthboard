/**
 * Weather from Open-Meteo (https://open-meteo.com): free, no API key, no account. The server
 * fetches and caches it; everything here is shared so the widget and the tests agree.
 */

export interface WeatherNow {
  /** °C */
  temp: number;
  /** °C */
  feelsLike: number;
  /** WMO weather code. */
  code: number;
  isDay: boolean;
  /** km/h */
  wind: number;
  /** % */
  humidity: number;
}

export interface WeatherDay {
  /** YYYY-MM-DD, in the place's own time zone. */
  date: string;
  code: number;
  /** °C */
  max: number;
  /** °C */
  min: number;
  /** Highest chance of rain or snow during the day, %, when known. */
  precipChance: number | null;
}

export interface WeatherDTO {
  current: WeatherNow;
  /** Today first. */
  daily: WeatherDay[];
  /** When the server fetched this (ms). */
  fetchedAt: number;
  /** True when the forecast couldn't be refreshed and this is the last good one. */
  stale: boolean;
}

export interface PlaceDTO {
  name: string;
  /** e.g. "Texas, United States". */
  region: string;
  latitude: number;
  longitude: number;
}

interface CodeInfo {
  label: string;
  day: string;
  night: string;
}

const sunny = (label: string): CodeInfo => ({ label, day: '☀️', night: '🌙' });
const plain = (label: string, icon: string): CodeInfo => ({ label, day: icon, night: icon });

/** WMO weather interpretation codes, as used by Open-Meteo. */
export const WEATHER_CODES: Record<number, CodeInfo> = {
  0: sunny('Clear'),
  1: { label: 'Mostly clear', day: '🌤️', night: '🌙' },
  2: { label: 'Partly cloudy', day: '⛅', night: '☁️' },
  3: plain('Cloudy', '☁️'),
  45: plain('Fog', '🌫️'),
  48: plain('Freezing fog', '🌫️'),
  51: plain('Light drizzle', '🌦️'),
  53: plain('Drizzle', '🌦️'),
  55: plain('Heavy drizzle', '🌧️'),
  56: plain('Freezing drizzle', '🌧️'),
  57: plain('Freezing drizzle', '🌧️'),
  61: plain('Light rain', '🌦️'),
  63: plain('Rain', '🌧️'),
  65: plain('Heavy rain', '🌧️'),
  66: plain('Freezing rain', '🌧️'),
  67: plain('Freezing rain', '🌧️'),
  71: plain('Light snow', '🌨️'),
  73: plain('Snow', '🌨️'),
  75: plain('Heavy snow', '❄️'),
  77: plain('Snow grains', '🌨️'),
  80: plain('Showers', '🌦️'),
  81: plain('Showers', '🌧️'),
  82: plain('Heavy showers', '⛈️'),
  85: plain('Snow showers', '🌨️'),
  86: plain('Heavy snow showers', '❄️'),
  95: plain('Thunderstorm', '⛈️'),
  96: plain('Thunderstorm, hail', '⛈️'),
  99: plain('Thunderstorm, hail', '⛈️'),
};

export function weatherInfo(code: number, isDay = true): { label: string; icon: string } {
  const info = WEATHER_CODES[code] ?? plain('Unknown', '🌡️');
  return { label: info.label, icon: isDay ? info.day : info.night };
}

/** Regions that use Fahrenheit. */
const FAHRENHEIT_REGIONS = new Set(['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH', 'PR']);

/** Resolve `auto` units from a locale like "en-US". */
export function resolveUnits(units: 'auto' | 'f' | 'c', locale: string): 'f' | 'c' {
  if (units !== 'auto') return units;
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale)?.[1]?.toUpperCase();
  return region && FAHRENHEIT_REGIONS.has(region) ? 'f' : 'c';
}

/** Whole degrees in the chosen unit. */
export function formatTemp(celsius: number, units: 'f' | 'c'): number {
  return Math.round(units === 'f' ? (celsius * 9) / 5 + 32 : celsius);
}

/** Wind speed with its unit: mph with °F, km/h with °C. */
export function formatWind(kmh: number, units: 'f' | 'c'): string {
  return units === 'f' ? `${Math.round(kmh / 1.609344)} mph` : `${Math.round(kmh)} km/h`;
}
