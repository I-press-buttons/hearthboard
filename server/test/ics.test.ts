import { describe, expect, it } from 'vitest';
import { buildIcs, expandIcs, patchIcs, removeOccurrence } from '../src/calendars/ics';

const NY_TZ = `BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`;

const weekly = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
${NY_TZ}
BEGIN:VEVENT
UID:weekly-1
DTSTAMP:20260101T000000Z
DTSTART;TZID=America/New_York:20261005T090000
DTEND;TZID=America/New_York:20261005T100000
RRULE:FREQ=WEEKLY;COUNT=6
SUMMARY:Standup
LOCATION:Kitchen
END:VEVENT
END:VCALENDAR`.replace(/\n/g, '\r\n');

const allDay = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:bday
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20261010
DTEND;VALUE=DATE:20261011
SUMMARY:Birthday
END:VEVENT
END:VCALENDAR`.replace(/\n/g, '\r\n');

const range = (a: string, b: string) => [new Date(a), new Date(b)] as const;

describe('expandIcs', () => {
  it('expands a weekly series in its own time zone across the DST change', () => {
    const occ = expandIcs(weekly, ...range('2026-10-01T00:00:00Z', '2026-12-31T00:00:00Z'));
    expect(occ).toHaveLength(6);
    expect(occ[0]).toMatchObject({
      title: 'Standup',
      start: '2026-10-05T13:00:00.000Z', // 09:00 EDT
      end: '2026-10-05T14:00:00.000Z',
      recurring: true,
      recurrenceId: '2026-10-05T13:00:00.000Z',
      location: 'Kitchen',
      allDay: false,
    });
    // 2026-11-09 is after DST ends: 09:00 EST = 14:00Z
    expect(occ[5].start).toBe('2026-11-09T14:00:00.000Z');
  });

  it('keeps only occurrences overlapping the window', () => {
    const occ = expandIcs(weekly, ...range('2026-10-10T00:00:00Z', '2026-10-20T00:00:00Z'));
    expect(occ.map((o) => o.start)).toEqual([
      '2026-10-12T13:00:00.000Z',
      '2026-10-19T13:00:00.000Z',
    ]);
  });

  it('gives up on a rule that can never match instead of hanging', () => {
    const rule = (r: string) =>
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:odd-1',
        'DTSTAMP:20260101T000000Z',
        'DTSTART:20260105T090000Z',
        'DTEND:20260105T100000Z',
        `RRULE:${r}`,
        'SUMMARY:Odd',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
    const win = range('2026-02-01T00:00:00Z', '2030-01-01T00:00:00Z');
    for (const r of ['FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30', 'FREQ=HOURLY;BYMONTH=4;BYMONTHDAY=31']) {
      expect(() => expandIcs(rule(r), ...win)).toThrow(/never matches/);
    }
    // Rare but real: an hourly rule on leap days still expands.
    const leap = expandIcs(rule('FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=29;BYHOUR=9'), ...win);
    expect(leap.map((o) => o.start)).toEqual(['2028-02-29T09:00:00.000Z']);
  });

  it('returns all-day events as dates with an exclusive end', () => {
    const [o] = expandIcs(allDay, ...range('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'));
    expect(o).toMatchObject({
      start: '2026-10-10',
      end: '2026-10-11',
      allDay: true,
      recurring: false,
    });
  });
});

describe('patchIcs', () => {
  it('moves a single occurrence with a RECURRENCE-ID override', () => {
    const out = patchIcs(weekly, {
      recurrenceId: '2026-10-12T13:00:00.000Z',
      scope: 'instance',
      start: '2026-10-13T15:00:00.000Z',
      end: '2026-10-13T16:00:00.000Z',
    });
    expect(out).toMatch(/RECURRENCE-ID;TZID=America\/New_York:20261012T090000/);
    const occ = expandIcs(out, ...range('2026-10-01T00:00:00Z', '2026-12-31T00:00:00Z'));
    expect(occ).toHaveLength(6);
    const moved = occ.find((o) => o.recurrenceId === '2026-10-12T13:00:00.000Z')!;
    expect(moved.start).toBe('2026-10-13T15:00:00.000Z');
    expect(moved.title).toBe('Standup');
    // Editing the same occurrence again updates the existing override.
    const again = patchIcs(out, { recurrenceId: moved.recurrenceId, title: 'Moved standup' });
    expect(again.match(/RECURRENCE-ID/g)).toHaveLength(1);
    const occ2 = expandIcs(again, ...range('2026-10-13T00:00:00Z', '2026-10-14T00:00:00Z'));
    expect(occ2).toMatchObject([{ title: 'Moved standup', start: '2026-10-13T15:00:00.000Z' }]);
  });

  it('shifts the whole series keeping its time zone', () => {
    const out = patchIcs(weekly, {
      recurrenceId: '2026-10-12T13:00:00.000Z',
      scope: 'series',
      start: '2026-10-12T14:00:00.000Z',
      end: '2026-10-12T15:30:00.000Z',
      title: 'Later standup',
    });
    const occ = expandIcs(out, ...range('2026-10-01T00:00:00Z', '2026-12-31T00:00:00Z'));
    expect(occ[0]).toMatchObject({
      start: '2026-10-05T14:00:00.000Z',
      end: '2026-10-05T15:30:00.000Z',
      title: 'Later standup',
    });
    // Still 10:00 local after DST ends.
    expect(occ[5].start).toBe('2026-11-09T15:00:00.000Z');
  });

  it('moves a plain event and keeps the duration when only start is given', () => {
    const ics = buildIcs(
      {
        title: 'Dentist',
        start: '2026-10-20T15:00:00Z',
        end: '2026-10-20T16:30:00Z',
        allDay: false,
      },
      'uid-1',
    );
    const out = patchIcs(ics, { start: '2026-10-21T13:00:00Z' });
    const [o] = expandIcs(out, ...range('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'));
    expect(o).toMatchObject({ start: '2026-10-21T13:00:00.000Z', end: '2026-10-21T14:30:00.000Z' });
    expect(out).toMatch(/SEQUENCE:1/);
  });

  it('converts a timed event into an all-day one', () => {
    const ics = buildIcs(
      { title: 'X', start: '2026-10-20T15:00:00Z', end: '2026-10-20T16:00:00Z', allDay: false },
      'u',
    );
    const out = patchIcs(ics, { start: '2026-10-20', end: '2026-10-21', allDay: true });
    expect(out).toMatch(/DTSTART;VALUE=DATE:20261020/);
    const [o] = expandIcs(out, ...range('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'));
    expect(o).toMatchObject({ allDay: true, start: '2026-10-20', end: '2026-10-21' });
  });
});

describe('removeOccurrence', () => {
  it('adds an EXDATE in the series time zone', () => {
    const out = removeOccurrence(weekly, '2026-10-19T13:00:00.000Z');
    expect(out).toMatch(/EXDATE;TZID=America\/New_York:20261019T090000/);
    const occ = expandIcs(out, ...range('2026-10-01T00:00:00Z', '2026-12-31T00:00:00Z'));
    expect(occ).toHaveLength(5);
    expect(occ.find((o) => o.recurrenceId === '2026-10-19T13:00:00.000Z')).toBeUndefined();
  });
});

describe('buildIcs', () => {
  it('writes a valid VCALENDAR with escaped text', () => {
    const out = buildIcs(
      {
        title: 'Soccer, then pizza; bring cleats',
        start: '2026-10-10',
        end: '2026-10-11',
        allDay: true,
        location: 'Field 3',
      },
      'abc@hearthboard',
    );
    expect(out).toMatch(/^BEGIN:VCALENDAR/);
    expect(out).toMatch(/UID:abc@hearthboard/);
    expect(out).toContain('SUMMARY:Soccer\\, then pizza\\; bring cleats');
    expect(out).toMatch(/DTSTART;VALUE=DATE:20261010/);
  });
});
