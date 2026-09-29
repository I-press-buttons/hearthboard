import ICAL from 'ical.js';

/** One concrete occurrence expanded out of an iCalendar resource. */
export interface Occurrence {
  uid: string;
  /** Set for occurrences of a recurring series (ISO UTC, or YYYY-MM-DD for all-day). */
  recurrenceId: string | null;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  recurring: boolean;
}

export interface IcsPatch {
  recurrenceId?: string | null;
  scope?: 'instance' | 'series';
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
}

export interface IcsInput {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string | null;
  description?: string | null;
}

const MAX_ITERATIONS = 20_000;
const PRODID = '-//Hearthboard//Wallboard//EN';

/**
 * ical.js gives up on MONTHLY and YEARLY rules that can never match, but a finer one such as
 * FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30 (from any subscribed feed) spins forever inside a single
 * `next()`, freezing the server. Allow each step this many candidate times, which is still
 * enough for an hourly rule that only matches on leap days.
 */
const MAX_CANDIDATES = 100_000;
type Budgeted = ICAL.RecurIterator & { budget: number };
const { next, check_contracting_rules: check } = ICAL.RecurIterator.prototype;
ICAL.RecurIterator.prototype.next = function (this: Budgeted, again?: boolean) {
  this.budget = MAX_CANDIDATES;
  return next.call(this, again);
};
ICAL.RecurIterator.prototype.check_contracting_rules = function (this: Budgeted) {
  if (--this.budget < 0) throw new Error('Recurrence rule never matches');
  return check.call(this);
};

/** Parse an iCalendar string and register the VTIMEZONEs it carries. */
export function parseIcs(ics: string): ICAL.Component {
  const comp = new ICAL.Component(ICAL.parse(ics));
  for (const tz of comp.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      /* malformed VTIMEZONE: times fall back to floating/local */
    }
  }
  return comp;
}

/** Serialize an ICAL.Time the way the API exposes dates. */
export function timeKey(t: ICAL.Time): string {
  return t.isDate ? t.toString().slice(0, 10) : t.toJSDate().toISOString();
}

function toTime(value: string, allDay: boolean): ICAL.Time {
  if (allDay) return ICAL.Time.fromDateString(value.slice(0, 10));
  return ICAL.Time.fromJSDate(new Date(value), true);
}

function text(comp: ICAL.Component, name: string): string | null {
  const v = comp.getFirstPropertyValue(name);
  return v === null || v === undefined || v === '' ? null : String(v);
}

function occurrence(
  ev: ICAL.Event,
  start: ICAL.Time,
  end: ICAL.Time,
  item: ICAL.Event,
  rid: ICAL.Time | null,
): Occurrence {
  return {
    uid: ev.uid,
    recurrenceId: rid ? timeKey(rid) : null,
    title: item.summary || '(no title)',
    start: timeKey(start),
    end: timeKey(end),
    allDay: start.isDate,
    location: text(item.component, 'location'),
    description: text(item.component, 'description'),
    recurring: !!rid,
  };
}

function overlaps(start: ICAL.Time, end: ICAL.Time, from: Date, to: Date): boolean {
  const s = start.toJSDate().getTime();
  const e = Math.max(end.toJSDate().getTime(), s + 1);
  return s < to.getTime() && e > from.getTime();
}

function splitEvents(comp: ICAL.Component) {
  const vevents = comp.getAllSubcomponents('vevent');
  const masters = vevents.filter((v) => !v.hasProperty('recurrence-id'));
  const exceptions = vevents.filter((v) => v.hasProperty('recurrence-id'));
  return { masters, exceptions };
}

function buildEvent(master: ICAL.Component, exceptions: ICAL.Component[]): ICAL.Event {
  const ev = new ICAL.Event(master);
  for (const ex of exceptions) {
    if (ex.getFirstPropertyValue('uid') === ev.uid) ev.relateException(ex);
  }
  return ev;
}

/** Expand every occurrence of the resource that overlaps [from, to). */
export function expandIcs(ics: string, from: Date, to: Date): Occurrence[] {
  const comp = parseIcs(ics);
  const { masters, exceptions } = splitEvents(comp);
  const out: Occurrence[] = [];

  for (const master of masters) {
    const ev = buildEvent(master, exceptions);
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) {
      if (overlaps(ev.startDate, ev.endDate, from, to)) {
        out.push(occurrence(ev, ev.startDate, ev.endDate, ev, null));
      }
      continue;
    }
    const it = ev.iterator();
    for (let i = 0, next = it.next(); next && i < MAX_ITERATIONS; i++, next = it.next()) {
      if (next.toJSDate() >= to) break;
      const d = ev.getOccurrenceDetails(next);
      if (overlaps(d.startDate, d.endDate, from, to)) {
        out.push(occurrence(ev, d.startDate, d.endDate, d.item, d.recurrenceId));
      }
    }
    // Overrides moved into the window from an original date outside of it.
    for (const exc of Object.values(ev.exceptions) as ICAL.Event[]) {
      const rid = exc.recurrenceId;
      if (rid.toJSDate() < to) continue; // already visited by the iterator above
      if (overlaps(exc.startDate, exc.endDate, from, to)) {
        out.push(occurrence(ev, exc.startDate, exc.endDate, exc, rid));
      }
    }
  }

  // Overrides whose master is not in this resource (servers may split them).
  const masterUids = new Set(masters.map((m) => m.getFirstPropertyValue('uid')));
  for (const ex of exceptions) {
    if (masterUids.has(ex.getFirstPropertyValue('uid'))) continue;
    const ev = new ICAL.Event(ex);
    if (overlaps(ev.startDate, ev.endDate, from, to)) {
      out.push(occurrence(ev, ev.startDate, ev.endDate, ev, ev.recurrenceId));
    }
  }
  return out;
}

function stamp(vevent: ICAL.Component) {
  const now = ICAL.Time.fromJSDate(new Date(), true);
  vevent.updatePropertyWithValue('dtstamp', now);
  vevent.updatePropertyWithValue('last-modified', now);
  const seq = Number(vevent.getFirstPropertyValue('sequence') ?? 0);
  vevent.updatePropertyWithValue('sequence', Number.isFinite(seq) ? seq + 1 : 1);
}

function setText(vevent: ICAL.Component, name: string, value: string | null | undefined) {
  if (value === undefined) return;
  if (value === null || value === '') vevent.removeAllProperties(name);
  else vevent.updatePropertyWithValue(name, value);
}

function applyFields(vevent: ICAL.Component, patch: IcsPatch, withTimes: boolean) {
  setText(vevent, 'summary', patch.title);
  setText(vevent, 'location', patch.location);
  setText(vevent, 'description', patch.description);
  if (withTimes && (patch.start || patch.end)) {
    const ev = new ICAL.Event(vevent);
    const allDay = patch.allDay ?? ev.startDate.isDate;
    const oldDuration = ev.endDate.toJSDate().getTime() - ev.startDate.toJSDate().getTime();
    const start = patch.start ?? timeKey(ev.startDate);
    const end =
      patch.end ??
      (allDay
        ? timeKey(ev.endDate)
        : new Date(new Date(start).getTime() + oldDuration).toISOString());
    ev.startDate = toTime(start, allDay);
    ev.endDate = toTime(end, allDay);
  }
  stamp(vevent);
}

/** Find the master VEVENT and the occurrence start that `recurrenceId` names. */
function findOccurrence(comp: ICAL.Component, recurrenceId: string) {
  const { masters, exceptions } = splitEvents(comp);
  for (const master of masters) {
    const ev = buildEvent(master, exceptions);
    if (!ev.isRecurring()) continue;
    const target = new Date(
      recurrenceId.length === 10 ? recurrenceId + 'T00:00:00Z' : recurrenceId,
    );
    const it = ev.iterator();
    for (let i = 0, next = it.next(); next && i < MAX_ITERATIONS; i++, next = it.next()) {
      if (timeKey(next) === recurrenceId) {
        const exception = exceptions.find(
          (x) =>
            x.getFirstPropertyValue('uid') === ev.uid &&
            timeKey(x.getFirstPropertyValue('recurrence-id') as ICAL.Time) === recurrenceId,
        );
        return { master, ev, rid: next, exception };
      }
      if (next.toJSDate().getTime() > target.getTime() + 86_400_000) break;
    }
  }
  return null;
}

/** Apply an edit to one occurrence or the whole event; returns the new iCalendar text. */
export function patchIcs(ics: string, patch: IcsPatch): string {
  const comp = parseIcs(ics);
  const { masters } = splitEvents(comp);
  if (!masters.length) throw new Error('Calendar object has no VEVENT');

  if (!patch.recurrenceId) {
    applyFields(masters[0], patch, true);
    return comp.toString();
  }

  const found = findOccurrence(comp, patch.recurrenceId);
  if (!found) throw new Error('That occurrence no longer exists');
  const { master, ev, rid, exception } = found;

  if (patch.scope === 'series') {
    // Move the series by the same offset the occurrence moved, keeping the master's time zone.
    if (patch.start) {
      const details = ev.getOccurrenceDetails(rid);
      const deltaSec = Math.round(
        (new Date(patch.start).getTime() - details.startDate.toJSDate().getTime()) / 1000,
      );
      const durSec = patch.end
        ? Math.round((new Date(patch.end).getTime() - new Date(patch.start).getTime()) / 1000)
        : null;
      const mev = new ICAL.Event(master);
      const start = mev.startDate.clone();
      if (start.isDate) start.day += Math.round(deltaSec / 86400);
      else start.addDuration(ICAL.Duration.fromSeconds(deltaSec));
      const end = start.clone();
      if (durSec !== null) {
        if (end.isDate) end.day += Math.max(1, Math.round(durSec / 86400));
        else end.addDuration(ICAL.Duration.fromSeconds(durSec));
      } else end.addDuration(mev.duration);
      mev.startDate = start;
      mev.endDate = end;
    }
    applyFields(master, { ...patch, start: undefined, end: undefined }, false);
    return comp.toString();
  }

  let target = exception;
  if (!target) {
    target = new ICAL.Component('vevent');
    for (const prop of master.getAllProperties()) {
      if (
        ['rrule', 'rdate', 'exdate', 'dtstart', 'dtend', 'duration', 'sequence'].includes(prop.name)
      )
        continue;
      target.addProperty(ICAL.Property.fromString(prop.toICALString()));
    }
    const details = ev.getOccurrenceDetails(rid);
    const tev = new ICAL.Event(target);
    tev.startDate = details.startDate.clone();
    tev.endDate = details.endDate.clone();
    tev.recurrenceId = rid.clone();
    comp.addSubcomponent(target);
  }
  applyFields(target, patch, true);
  return comp.toString();
}

/** Remove one occurrence of a recurring event (EXDATE on the master). */
export function removeOccurrence(ics: string, recurrenceId: string): string {
  const comp = parseIcs(ics);
  const found = findOccurrence(comp, recurrenceId);
  if (!found) return ics;
  const { master, rid, exception } = found;
  if (exception) comp.removeSubcomponent(exception);
  const prop = new ICAL.Property('exdate', master);
  const dtstart = master.getFirstProperty('dtstart');
  const tzid = dtstart?.getParameter('tzid');
  if (tzid && !rid.isDate) prop.setParameter('tzid', tzid);
  prop.setValue(rid.clone());
  master.addProperty(prop);
  stamp(master);
  return comp.toString();
}

/** Build a new single-event VCALENDAR. Timed events are written in UTC. */
export function buildIcs(input: IcsInput, uid: string): string {
  const cal = new ICAL.Component('vcalendar');
  cal.updatePropertyWithValue('version', '2.0');
  cal.updatePropertyWithValue('prodid', PRODID);
  const vevent = new ICAL.Component('vevent');
  cal.addSubcomponent(vevent);
  vevent.updatePropertyWithValue('uid', uid);
  const ev = new ICAL.Event(vevent);
  ev.startDate = toTime(input.start, input.allDay);
  ev.endDate = toTime(input.end, input.allDay);
  vevent.updatePropertyWithValue('created', ICAL.Time.fromJSDate(new Date(), true));
  applyFields(
    vevent,
    { title: input.title, location: input.location, description: input.description },
    false,
  );
  vevent.updatePropertyWithValue('sequence', 0);
  return cal.toString();
}

export function icsUid(ics: string): string | null {
  const comp = parseIcs(ics);
  const v = comp.getFirstSubcomponent('vevent');
  return (v?.getFirstPropertyValue('uid') as string | null) ?? null;
}
