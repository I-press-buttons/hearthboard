import { describe, expect, it } from 'vitest';
import { CountdownConfig, countdownLabel, stripKeyword, upcomingCountdowns } from '../src';

const NOW = new Date(2026, 8, 29, 15, 30); // Tue 29 Sep 2026, afternoon

describe('countdowns', () => {
  it('counts whole days, soonest first, and drops past one-off dates', () => {
    const list = upcomingCountdowns(
      [
        { title: 'Beach', date: '2026-10-09', emoji: '🏖️', yearly: false },
        { title: 'Today thing', date: '2026-09-29', emoji: '', yearly: false },
        { title: 'Done', date: '2026-09-01', emoji: '', yearly: false },
      ],
      NOW,
    );
    expect(list).toEqual([
      { title: 'Today thing', emoji: '', date: '2026-09-29', days: 0 },
      { title: 'Beach', emoji: '🏖️', date: '2026-10-09', days: 10 },
    ]);
  });

  it('moves yearly dates to their next anniversary', () => {
    const [bday] = upcomingCountdowns(
      [{ title: 'Emma', date: '2015-03-14', emoji: '🎂', yearly: true }],
      NOW,
    );
    expect(bday.date).toBe('2027-03-14');
    const [xmas] = upcomingCountdowns(
      [{ title: 'Christmas', date: '2000-12-25', emoji: '🎄', yearly: true }],
      NOW,
    );
    expect(xmas).toMatchObject({ date: '2026-12-25', days: 87 });
    // Leap-day birthdays land on Feb 28 in other years.
    const [leap] = upcomingCountdowns(
      [{ title: 'Leap', date: '2016-02-29', emoji: '', yearly: true }],
      NOW,
    );
    expect(leap.date).toBe('2027-02-28');
  });

  it('counts across a daylight-saving change', () => {
    const [d] = upcomingCountdowns(
      [{ title: 'After DST', date: '2026-11-02', emoji: '', yearly: false }],
      NOW,
    );
    expect(d.days).toBe(34);
  });

  it('labels in days or sleeps', () => {
    expect(countdownLabel(0, 'days')).toBe('Today!');
    expect(countdownLabel(1, 'days')).toBe('Tomorrow');
    expect(countdownLabel(12, 'days')).toBe('12 days');
    expect(countdownLabel(1, 'sleeps')).toBe('1 sleep');
    expect(countdownLabel(3, 'sleeps')).toBe('3 sleeps');
  });

  it('strips the calendar keyword from event titles', () => {
    expect(stripKeyword('Beach trip #countdown', '#countdown')).toBe('Beach trip');
    expect(stripKeyword('🎉 Party 🎉', '🎉')).toBe('Party');
    expect(stripKeyword('Plain', '')).toBe('Plain');
  });

  it('drops a broken entry instead of the whole list', () => {
    const cfg = CountdownConfig.parse({
      entries: [
        { title: 'Ok', date: '2026-12-01' },
        { title: 'Bad', date: 'soon' },
      ],
    });
    expect(cfg.entries.map((e) => e.title)).toEqual(['Ok']);
  });
});
