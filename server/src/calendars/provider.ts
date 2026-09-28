import type { EventDelete, EventInput, EventPatch } from '@hearthboard/shared';

export interface RemoteCalendar {
  remoteId: string;
  name: string;
  color: string | null;
  writable: boolean;
}

/** A stored calendar object: an .ics file (CalDAV) or one Google event instance (JSON). */
export interface RemoteResource {
  remoteId: string;
  etag: string | null;
  kind: 'ics' | 'gevent';
  payload: string;
}

export interface SyncResult {
  /** When true, `upserts` is the complete set and anything else stored for the calendar is gone. */
  full: boolean;
  upserts: RemoteResource[];
  deletes: string[];
  cursor: string | null;
  /** Nothing changed since `cursor`. */
  unchanged?: boolean;
}

export interface CalendarRef {
  remoteId: string;
  cursor: string | null;
}

export interface SyncWindow {
  start: Date;
  end: Date;
}

/**
 * Result of a write: the updated resource, null when the resource was deleted, or
 * 'resync' when the change touched many stored resources (e.g. a Google series edit).
 */
export type WriteResult = RemoteResource | null | 'resync';

export interface CalendarProvider {
  listCalendars(): Promise<RemoteCalendar[]>;
  sync(cal: CalendarRef, window: SyncWindow): Promise<SyncResult>;
  create(cal: CalendarRef, input: Omit<EventInput, 'calendarId'>): Promise<RemoteResource>;
  update(cal: CalendarRef, res: RemoteResource, patch: EventPatch): Promise<WriteResult>;
  remove(cal: CalendarRef, res: RemoteResource, del: EventDelete): Promise<WriteResult>;
}

/** The server rejected a write because the object changed since we last synced (HTTP 412). */
export class ConflictError extends Error {
  constructor(message = 'This event was changed somewhere else. The board has refreshed it; try again.') {
    super(message);
  }
}

export class AuthError extends Error {}
