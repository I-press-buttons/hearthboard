import { z } from 'zod';
import { WidgetType } from './widgets';
import { DEFAULT_TEXT_SIZE, DEFAULT_THEME, TEXT_SIZE_IDS, THEME_IDS } from './themes';

export const WidgetInstance = z.object({
  id: z.string().min(1).max(64),
  type: WidgetType,
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
  /** Text size for just this widget; leave unset to follow the board. */
  textSize: z.enum(TEXT_SIZE_IDS).optional().catch(undefined),
});
export type WidgetInstance = z.infer<typeof WidgetInstance>;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

/** Display dimming as a new board has it. */
const DIM_DEFAULTS = { enabled: false, start: '22:00', end: '06:30', level: 0.25 };

/** "Between these times, show that board instead." Days use 0 = Sunday … 6 = Saturday. */
export const BoardScheduleEntry = z.object({
  boardId: z.string().min(1).max(64),
  start: HHMM,
  end: HHMM,
  /** Days the window starts on; empty = every day. */
  days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
});
export type BoardScheduleEntry = z.infer<typeof BoardScheduleEntry>;

export const Board = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  /** Target screen resolution; the board is scaled to fit whatever shows it. */
  width: z.number().int().min(320).max(7680).default(1920),
  height: z.number().int().min(320).max(7680).default(1080),
  cols: z.number().int().min(4).max(64).default(24),
  rows: z.number().int().min(4).max(64).default(16),
  margin: z.number().int().min(0).max(64).default(12),
  /** Color theme; see themes.ts. Unknown keys fall back to the default. */
  theme: z.enum(THEME_IDS).default(DEFAULT_THEME).catch(DEFAULT_THEME),
  /** Text size for every widget on the board; see themes.ts. */
  textSize: z.enum(TEXT_SIZE_IDS).default(DEFAULT_TEXT_SIZE).catch(DEFAULT_TEXT_SIZE),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#f59e0b'),
  /** Dim the display between these times (local time), e.g. 22:00 -> 06:30. */
  dim: z
    .object({
      enabled: z.boolean().default(DIM_DEFAULTS.enabled),
      start: HHMM.default(DIM_DEFAULTS.start),
      end: HHMM.default(DIM_DEFAULTS.end),
      level: z.number().min(0.05).max(1).default(DIM_DEFAULTS.level),
    })
    // The whole object, not `{}`: zod 4 returns a default as it is, without filling in the
    // fields' own defaults, so a board saved without `dim` would get an empty one.
    .default(() => ({ ...DIM_DEFAULTS })),
  /** Shift the whole board by a pixel or two every few minutes to limit burn-in. */
  pixelShift: z.boolean().default(true),
  /**
   * Touch-screen mode, for a wall tablet: anyone at the screen can tick this board's checklists
   * and reminders without signing in. Nothing else becomes editable.
   */
  interactive: z.boolean().default(false),
  /** Ask the screen's browser to stay awake (Screen Wake Lock). Needs HTTPS on most tablets. */
  keepAwake: z.boolean().default(false),
  /** Show other boards at set times of day, e.g. a morning-routine board before school. */
  schedule: z.array(BoardScheduleEntry).max(20).default([]),
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

const toMinutes = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

/** True when `now` falls inside the [start, end) HH:MM window, which may wrap midnight. */
export function inTimeWindow(now: Date, start: string, end: string): boolean {
  const mins = now.getHours() * 60 + now.getMinutes();
  const a = toMinutes(start);
  const b = toMinutes(end);
  if (a === b) return false;
  return a < b ? mins >= a && mins < b : mins >= a || mins < b;
}

/** True when a schedule entry is active at `now`. A window past midnight belongs to the day it starts on. */
export function scheduleActive(entry: BoardScheduleEntry, now: Date): boolean {
  if (!inTimeWindow(now, entry.start, entry.end)) return false;
  if (!entry.days.length) return true;
  const mins = now.getHours() * 60 + now.getMinutes();
  const wraps = toMinutes(entry.start) > toMinutes(entry.end);
  // After midnight in a window like 22:00–02:00, the window started yesterday.
  const startedYesterday = wraps && mins < toMinutes(entry.end);
  const day = (now.getDay() + (startedYesterday ? 6 : 0)) % 7;
  return entry.days.includes(day);
}

/** The board a screen showing `board` should show at `now`: the first active schedule entry, or itself. */
export function scheduledBoardId(board: Pick<Board, 'id' | 'schedule'>, now: Date): string {
  return board.schedule.find((e) => scheduleActive(e, now))?.boardId ?? board.id;
}

/** File format of an exported board layout. */
export const BOARD_EXPORT_VERSION = 1;
export interface BoardExport {
  hearthboard: typeof BOARD_EXPORT_VERSION;
  exportedAt: string;
  board: Board;
}

export function exportBoard(board: Board, now = new Date()): BoardExport {
  return { hearthboard: BOARD_EXPORT_VERSION, exportedAt: now.toISOString(), board };
}

/**
 * Read an exported layout (or a bare board object) for importing as a new board: a new id and
 * widget ids, and no schedule (its board ids belong to the install it came from).
 */
export function boardFromExport(data: unknown, newId: string, makeWidgetId: () => string): Board {
  const raw =
    data && typeof data === 'object' && 'board' in data ? (data as { board: unknown }).board : data;
  const obj = raw as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.widgets))
    throw new Error('That file is not a Hearthboard layout.');
  const widgets = obj.widgets as unknown[];
  const res = Board.safeParse({
    ...obj,
    id: newId,
    name:
      typeof obj.name === 'string' && obj.name.trim()
        ? obj.name.trim().slice(0, 100)
        : 'Imported board',
    schedule: [],
    widgets: widgets.map((w) => ({ ...(w as object), id: makeWidgetId() })),
  });
  if (!res.success) {
    const first = res.error.issues[0];
    throw new Error(
      `That layout is not valid (${first.path.join('.') || 'board'}: ${first.message}).`,
    );
  }
  return res.data;
}
