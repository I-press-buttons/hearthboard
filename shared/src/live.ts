/** Topics pushed over the /ws socket. Clients refetch the matching data when one arrives. */
export const LIVE_TOPICS = [
  'board',
  'events',
  'calendars',
  'reminders',
  'checklists',
  'quotes',
  'photos',
  'reload',
] as const;
export type LiveTopic = (typeof LIVE_TOPICS)[number];

export interface LiveMessage {
  topic: LiveTopic;
  /** Optional id narrowing the change, e.g. a board or checklist id. */
  id?: string;
}
