import { z } from 'zod';

export const WIDGET_TYPES = ['clock', 'calendar', 'reminders', 'photo', 'quote', 'checklist'] as const;
export const WidgetType = z.enum(WIDGET_TYPES);
export type WidgetType = z.infer<typeof WidgetType>;

export const ClockConfig = z.object({
  hour24: z.boolean().default(false),
  showSeconds: z.boolean().default(false),
  showDate: z.boolean().default(true),
});

export const CALENDAR_VIEWS = ['dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listWeek', 'agenda'] as const;
export const CalendarConfig = z.object({
  view: z.enum(CALENDAR_VIEWS).default('dayGridMonth'),
  /** Calendar ids to show; empty = every enabled calendar. */
  calendarIds: z.array(z.string()).default([]),
  /** Days shown by the agenda view. */
  agendaDays: z.number().int().min(1).max(60).default(7),
  showWeekends: z.boolean().default(true),
  title: z.string().default(''),
});

export const RemindersConfig = z.object({
  title: z.string().default('Reminders'),
  /** Reminder list names to show; empty = all lists. */
  lists: z.array(z.string()).default([]),
  maxItems: z.number().int().min(1).max(100).default(15),
  showDue: z.boolean().default(true),
});

export const PhotoConfig = z.object({
  source: z.enum(['folder', 'synology']).default('folder'),
  /** Sub-folder of the mounted photo folder (folder source). */
  folder: z.string().default(''),
  /** Synology Photos album id (synology source). */
  albumId: z.string().default(''),
  intervalSec: z.number().int().min(5).max(86400).default(60),
  fit: z.enum(['cover', 'contain']).default('cover'),
  kenBurns: z.boolean().default(true),
  showCaption: z.boolean().default(false),
});

export const QuoteConfig = z.object({
  mode: z.enum(['verse', 'quote', 'both', 'custom']).default('verse'),
  rotate: z.enum(['daily', 'hourly']).default('daily'),
  fontScale: z.number().min(0.5).max(3).default(1),
});

export const ChecklistConfig = z.object({
  checklistId: z.string().default(''),
  hideDone: z.boolean().default(false),
});

export const WidgetConfigSchemas = {
  clock: ClockConfig,
  calendar: CalendarConfig,
  reminders: RemindersConfig,
  photo: PhotoConfig,
  quote: QuoteConfig,
  checklist: ChecklistConfig,
} satisfies Record<WidgetType, z.ZodTypeAny>;

export type WidgetConfigs = {
  [K in WidgetType]: z.infer<(typeof WidgetConfigSchemas)[K]>;
};

/** Parse a stored widget config, filling defaults and dropping junk. */
export function parseWidgetConfig<T extends WidgetType>(type: T, raw: unknown): WidgetConfigs[T] {
  const schema = WidgetConfigSchemas[type];
  const res = schema.safeParse(raw ?? {});
  return (res.success ? res.data : schema.parse({})) as WidgetConfigs[T];
}

/** Default grid size (in board cells) for newly added widgets. */
export const WIDGET_DEFAULT_SIZE: Record<WidgetType, { w: number; h: number; minW: number; minH: number }> = {
  clock: { w: 6, h: 3, minW: 2, minH: 1 },
  calendar: { w: 12, h: 9, minW: 4, minH: 3 },
  reminders: { w: 6, h: 6, minW: 3, minH: 2 },
  photo: { w: 6, h: 6, minW: 2, minH: 2 },
  quote: { w: 8, h: 3, minW: 3, minH: 2 },
  checklist: { w: 6, h: 6, minW: 3, minH: 2 },
};
