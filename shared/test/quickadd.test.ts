import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../src';

// Tuesday 29 September 2026, 10:00 (tests run in America/New_York).
const NOW = new Date(2026, 8, 29, 10, 0);
const at = (m: number, d: number, h = 0, min = 0, y = 2026) => new Date(y, m - 1, d, h, min);
const parse = (s: string, dayFirst = false) => parseQuickAdd(s, NOW, { dayFirst });

describe('quick add', () => {
  it('reads a weekday, a time range and a place', () => {
    expect(parse('Soccer Sat 9-10:30am @ Riverside Park')).toEqual({
      title: 'Soccer',
      location: 'Riverside Park',
      allDay: false,
      start: at(10, 3, 9),
      end: at(10, 3, 10, 30),
    });
  });

  it('takes "at <Place>" as the location, but not "at <lowercase word>"', () => {
    expect(parse("Dinner at Grandma's tomorrow 6pm")).toMatchObject({
      title: 'Dinner',
      location: "Grandma's",
      start: at(9, 30, 18),
      end: at(9, 30, 19),
    });
    expect(parse('Party at the park Friday 3pm')?.location).toBe('the park');
    expect(parse('Look at photos')).toMatchObject({ title: 'Look at photos', location: null });
  });

  it('reads month names, ordinals and numeric dates', () => {
    expect(parse('Dentist Oct 3 at 2:30')).toMatchObject({
      title: 'Dentist',
      start: at(10, 3, 14, 30),
      end: at(10, 3, 15, 30),
    });
    expect(parse('Recital on the 12th of December 7pm')?.start).toEqual(at(12, 12, 19));
    expect(parse('Workshop 2026-11-05 3pm for 2 hours')).toMatchObject({
      start: at(11, 5, 15),
      end: at(11, 5, 17),
    });
    // Month-first by default; day-first when the device's locale says so.
    expect(parse('Run 3/10')?.start).toEqual(at(3, 10, 0, 0, 2027));
    expect(parse('Run 3/10', true)?.start).toEqual(at(10, 3));
  });

  it('rolls dates that have passed this year to next year', () => {
    expect(parse('Camp Jul 14-18')).toEqual({
      title: 'Camp',
      location: null,
      allDay: true,
      start: at(7, 14, 0, 0, 2027),
      end: at(7, 19, 0, 0, 2027),
    });
  });

  it('makes all-day events when there is no time', () => {
    expect(parse('Pay bills')).toMatchObject({ allDay: true, start: at(9, 29), end: at(9, 30) });
    expect(parse('Vacation all day Friday')).toMatchObject({
      title: 'Vacation',
      allDay: true,
      start: at(10, 2),
    });
    expect(parse('Trip for 3 days in 2 weeks')).toMatchObject({
      title: 'Trip',
      allDay: true,
      start: at(10, 13),
      end: at(10, 16),
    });
  });

  it('puts a time without a day on today, or tomorrow once it has passed', () => {
    expect(parse('Pizza 5:30')?.start).toEqual(at(9, 29, 17, 30));
    expect(parse('Call mom at 9am')?.start).toEqual(at(9, 30, 9));
    expect(parse('Standup 9am to 9:15')).toMatchObject({
      start: at(9, 30, 9),
      end: at(9, 30, 9, 15),
    });
  });

  it('reads evening hours without am/pm the way people mean them', () => {
    expect(parse('Movie tonight')?.start).toEqual(at(9, 29, 19));
    expect(parse('Movie tonight at 8')?.start).toEqual(at(9, 29, 20));
    expect(parse('Book club Thursday at 7')?.start).toEqual(at(10, 1, 19));
    expect(parse('Swim Thursday 06:30')?.start).toEqual(at(10, 1, 6, 30));
  });

  it('handles ranges across noon and midnight', () => {
    expect(parse('Team lunch friday noon-1:30')).toMatchObject({
      title: 'Team lunch',
      start: at(10, 2, 12),
      end: at(10, 2, 13, 30),
    });
    expect(parse('Review next friday 11-1pm')).toMatchObject({
      start: at(10, 9, 11),
      end: at(10, 9, 13),
    });
    expect(parse('Party Saturday 10pm-1am')).toMatchObject({
      start: at(10, 3, 22),
      end: at(10, 4, 1),
    });
  });

  it('treats a weekday named today as today, and "next" as the week after', () => {
    expect(parse('Trash tuesday')?.start).toEqual(at(9, 29));
    expect(parse('Trash next tuesday')?.start).toEqual(at(10, 6));
    expect(parse('Groceries wed')?.start).toEqual(at(9, 30));
  });

  it('returns null when nothing is left for a title', () => {
    expect(parse('tomorrow at 7')).toBeNull();
    expect(parse('   ')).toBeNull();
  });

  it('ignores impossible dates', () => {
    expect(parse('Party Feb 30')).toMatchObject({ title: 'Party Feb 30', start: at(9, 29) });
  });
});
