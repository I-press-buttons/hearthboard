import { z } from 'zod';

export const PROVIDERS = ['caldav', 'google', 'ics', 'demo'] as const;
export type ProviderKind = (typeof PROVIDERS)[number];

export interface AccountDTO {
  id: string;
  provider: ProviderKind;
  name: string;
  status: 'ok' | 'error' | 'syncing';
  lastError: string | null;
  lastSync: number | null;
}

export interface CalendarDTO {
  id: string;
  accountId: string;
  provider: ProviderKind;
  name: string;
  color: string;
  enabled: boolean;
  writable: boolean;
  /** An admin has let family members (not just admins) add and change events here. */
  membersCanEdit: boolean;
  /**
   * Whether the person asking may add and change events here: an admin on any writable
   * calendar, a member only where `membersCanEdit` is on. Never true when not signed in.
   */
  editable: boolean;
}

/**
 * One occurrence of an event. `resourceId` names the stored calendar object and
 * `recurrenceId` (when set) the occurrence inside a recurring series.
 */
export interface EventDTO {
  id: string;
  resourceId: string;
  recurrenceId: string | null;
  calendarId: string;
  title: string;
  /** ISO date-time for timed events, YYYY-MM-DD for all-day events. */
  start: string;
  /** Exclusive end, same format as start. */
  end: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  recurring: boolean;
  color: string;
  /** Whether the person asking may change or delete this event (see `CalendarDTO.editable`). */
  editable: boolean;
}

const DateOrDateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date');

export const EventInput = z.object({
  calendarId: z.string().min(1),
  title: z.string().min(1).max(500),
  start: DateOrDateTime,
  end: DateOrDateTime,
  allDay: z.boolean().default(false),
  location: z.string().max(500).nullish(),
  description: z.string().max(5000).nullish(),
});
export type EventInput = z.infer<typeof EventInput>;

export const EventPatch = z.object({
  recurrenceId: z.string().nullish(),
  /** `instance` changes one occurrence, `series` the whole recurring event. */
  scope: z.enum(['instance', 'series']).default('instance'),
  title: z.string().min(1).max(500).optional(),
  start: DateOrDateTime.optional(),
  end: DateOrDateTime.optional(),
  allDay: z.boolean().optional(),
  location: z.string().max(500).nullish(),
  description: z.string().max(5000).nullish(),
});
export type EventPatch = z.infer<typeof EventPatch>;

export const EventDelete = z.object({
  recurrenceId: z.string().nullish(),
  scope: z.enum(['instance', 'series']).default('instance'),
});
export type EventDelete = z.infer<typeof EventDelete>;
