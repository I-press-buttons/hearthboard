import { z } from 'zod';
import { WidgetType } from './widgets';

export const WidgetInstance = z.object({
  id: z.string().min(1).max(64),
  type: WidgetType,
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  config: z.record(z.unknown()).default({}),
});
export type WidgetInstance = z.infer<typeof WidgetInstance>;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const Board = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  /** Target screen resolution; the board is scaled to fit whatever shows it. */
  width: z.number().int().min(320).max(7680).default(1920),
  height: z.number().int().min(320).max(7680).default(1080),
  cols: z.number().int().min(4).max(64).default(24),
  rows: z.number().int().min(4).max(64).default(16),
  margin: z.number().int().min(0).max(64).default(12),
  theme: z.enum(['dark', 'light']).default('dark'),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#f59e0b'),
  /** Dim the display between these times (local time), e.g. 22:00 -> 06:30. */
  dim: z
    .object({
      enabled: z.boolean().default(false),
      start: HHMM.default('22:00'),
      end: HHMM.default('06:30'),
      level: z.number().min(0.05).max(1).default(0.25),
    })
    .default({}),
  /** Shift the whole board by a pixel or two every few minutes to limit burn-in. */
  pixelShift: z.boolean().default(true),
  widgets: z.array(WidgetInstance).max(100).default([]),
});
export type Board = z.infer<typeof Board>;

export const RESOLUTION_PRESETS = [
  { label: '1080p landscape (1920×1080)', width: 1920, height: 1080 },
  { label: '1080p portrait (1080×1920)', width: 1080, height: 1920 },
  { label: '1440p landscape (2560×1440)', width: 2560, height: 1440 },
  { label: '4K landscape (3840×2160)', width: 3840, height: 2160 },
  { label: 'Tablet landscape (1366×1024)', width: 1366, height: 1024 },
] as const;

/** True when `now` falls inside the [start, end) HH:MM window, which may wrap midnight. */
export function inTimeWindow(now: Date, start: string, end: string): boolean {
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  };
  const a = toMin(start);
  const b = toMin(end);
  if (a === b) return false;
  return a < b ? mins >= a && mins < b : mins >= a || mins < b;
}
