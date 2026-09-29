import { z } from 'zod';

export const WIDGET_TYPES = [
  'clock',
  'calendar',
  'reminders',
  'photo',
  'quote',
  'checklist',
  'weather',
  'countdown',
  'meals',
  'notes',
] as const;
export const WidgetType = z.enum(WIDGET_TYPES);
export type WidgetType = z.infer<typeof WidgetType>;

export const ClockConfig = z.object({
  hour24: z.boolean().default(false),
  showSeconds: z.boolean().default(false),
  showDate: z.boolean().default(true),
});

export const CALENDAR_VIEWS = [
  'dayGridMonth',
  'timeGridWeek',
  'timeGridDay',
  'listWeek',
  'agenda',
] as const;
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

export const WeatherConfig = z.object({
  /** Place name shown on the widget, e.g. "Austin, Texas". */
  place: z.string().max(200).default(''),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  /** `auto` picks °F in the US (and a few other places), °C elsewhere, from the screen's locale. */
  units: z.enum(['auto', 'f', 'c']).default('auto'),
  /** Days of forecast under today's conditions (0 = just today). */
  days: z.number().int().min(0).max(7).default(4),
});

export const CountdownEntry = z.object({
  title: z.string().max(100).default(''),
  /** YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  emoji: z.string().max(16).default(''),
  /** Comes round every year (birthdays, holidays). */
  yearly: z.boolean().default(false),
});
export type CountdownEntry = z.infer<typeof CountdownEntry>;

export const CountdownConfig = z.object({
  title: z.string().max(100).default('Countdowns'),
  /** Entries that fail validation are dropped instead of wiping the whole list. */
  entries: z
    .array(CountdownEntry.nullable().catch(null))
    .max(30)
    .default([])
    .transform((list) => list.filter((e): e is CountdownEntry => e !== null)),
  /** Also count down to calendar events whose title contains this, e.g. "🎉" or "#countdown". */
  keyword: z.string().max(40).default(''),
  /** Count in days, or in "sleeps" for the kids. */
  unit: z.enum(['days', 'sleeps']).default('days'),
  maxItems: z.number().int().min(1).max(30).default(5),
});

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MealsConfig = z.object({
  title: z.string().max(100).default('Meal plan'),
  days: z.number().int().min(1).max(14).default(7),
  /** Which meals to show. */
  slots: z.array(z.enum(MEAL_SLOTS)).min(1).default(['dinner']),
  /** Start from today, or from the start of the week (Sunday). */
  startOn: z.enum(['today', 'week']).default('today'),
});

export const NotesConfig = z.object({
  title: z.string().max(100).default('Notes'),
  maxItems: z.number().int().min(1).max(30).default(6),
  style: z.enum(['sticky', 'list']).default('sticky'),
});

export const WidgetConfigSchemas = {
  clock: ClockConfig,
  calendar: CalendarConfig,
  reminders: RemindersConfig,
  photo: PhotoConfig,
  quote: QuoteConfig,
  checklist: ChecklistConfig,
  weather: WeatherConfig,
  countdown: CountdownConfig,
  meals: MealsConfig,
  notes: NotesConfig,
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
export const WIDGET_DEFAULT_SIZE: Record<
  WidgetType,
  { w: number; h: number; minW: number; minH: number }
> = {
  clock: { w: 6, h: 3, minW: 2, minH: 1 },
  calendar: { w: 12, h: 9, minW: 4, minH: 3 },
  reminders: { w: 6, h: 6, minW: 3, minH: 2 },
  photo: { w: 6, h: 6, minW: 2, minH: 2 },
  quote: { w: 8, h: 3, minW: 3, minH: 2 },
  checklist: { w: 6, h: 6, minW: 3, minH: 2 },
  weather: { w: 6, h: 5, minW: 3, minH: 2 },
  countdown: { w: 6, h: 5, minW: 3, minH: 2 },
  meals: { w: 6, h: 7, minW: 3, minH: 3 },
  notes: { w: 8, h: 5, minW: 3, minH: 2 },
};
