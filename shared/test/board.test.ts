import { describe, expect, it } from 'vitest';
import {
  Board,
  boardFromExport,
  exportBoard,
  formatTemp,
  formatWind,
  nudgeWidget,
  resolveUnits,
  scheduledBoardId,
  weatherInfo,
} from '../src';

const at = (day: number, h: number, m = 0) => new Date(2026, 8, day, h, m); // Sep 2026; the 27th is a Sunday

describe('board schedules', () => {
  const board = Board.parse({
    id: 'home',
    name: 'Home',
    schedule: [
      { boardId: 'morning', start: '06:00', end: '08:30', days: [1, 2, 3, 4, 5] },
      { boardId: 'night', start: '21:00', end: '02:00', days: [5, 6] },
      { boardId: 'lunch', start: '12:00', end: '13:00' },
    ],
  });

  it('shows the scheduled board inside its window on its days', () => {
    expect(scheduledBoardId(board, at(28, 7))).toBe('morning'); // Monday
    expect(scheduledBoardId(board, at(27, 7))).toBe('home'); // Sunday
    expect(scheduledBoardId(board, at(28, 8, 30))).toBe('home'); // end is exclusive
    expect(scheduledBoardId(board, at(27, 12, 30))).toBe('lunch'); // every day
  });

  it('keeps a window past midnight on the day it started', () => {
    expect(scheduledBoardId(board, at(25, 23))).toBe('night'); // Friday night
    expect(scheduledBoardId(board, at(26, 1))).toBe('night'); // still Friday's window
    expect(scheduledBoardId(board, at(27, 1))).toBe('night'); // Saturday's window
    expect(scheduledBoardId(board, at(28, 1))).toBe('home'); // Sunday's would start Sunday: not scheduled
  });
});

describe('layout export', () => {
  it('imports as a new board with new ids and no schedule', () => {
    const original = Board.parse({
      id: 'abc',
      name: 'Kitchen',
      theme: 'light',
      schedule: [{ boardId: 'x', start: '06:00', end: '07:00' }],
      widgets: [{ id: 'w1', type: 'clock', x: 0, y: 0, w: 4, h: 2, config: { hour24: true } }],
    });
    let n = 0;
    const copy = boardFromExport(
      JSON.parse(JSON.stringify(exportBoard(original))),
      'new1',
      () => `id${++n}`,
    );
    expect(copy).toMatchObject({ id: 'new1', name: 'Kitchen', theme: 'light', schedule: [] });
    expect(copy.widgets).toEqual([{ ...original.widgets[0], id: 'id1' }]);
    // A bare board object works too.
    expect(boardFromExport(original, 'new2', () => 'w').name).toBe('Kitchen');
  });

  it('rejects files that are not layouts', () => {
    expect(() => boardFromExport('hello', 'x', () => 'w')).toThrow(/not a Hearthboard layout/);
    expect(() =>
      boardFromExport({ widgets: [{ type: 'toaster', x: 0, y: 0, w: 1, h: 1 }] }, 'x', () => 'w'),
    ).toThrow(/not valid/);
  });
});

describe('keyboard nudging', () => {
  const board = Board.parse({
    id: 'b',
    name: 'B',
    cols: 10,
    rows: 10,
    widgets: [
      { id: 'a', type: 'clock', x: 0, y: 0, w: 3, h: 2 },
      { id: 'b', type: 'clock', x: 4, y: 0, w: 3, h: 2 },
    ],
  });

  it('moves and resizes by whole cells', () => {
    expect(nudgeWidget(board, 'a', { dy: 1 })?.[0]).toMatchObject({ x: 0, y: 1 });
    expect(nudgeWidget(board, 'a', { dw: 1 })?.[0]).toMatchObject({ w: 4 });
  });

  it('refuses to overlap, leave the grid or go below the minimum size', () => {
    expect(nudgeWidget(board, 'a', { dw: 2 })).toBeNull(); // into "b"
    expect(nudgeWidget(board, 'a', { dx: -1 })).toBeNull();
    expect(nudgeWidget(board, 'b', { dx: 4 })).toBeNull();
    expect(nudgeWidget(board, 'a', { dh: -1, dw: -1 })?.[0]).toMatchObject({ w: 2, h: 1 });
    expect(nudgeWidget(board, 'a', { dw: -2 })).toBeNull(); // clock min width is 2
  });
});

describe('weather helpers', () => {
  it('picks units from the locale', () => {
    expect(resolveUnits('auto', 'en-US')).toBe('f');
    expect(resolveUnits('auto', 'en-GB')).toBe('c');
    expect(resolveUnits('auto', 'en')).toBe('c');
    expect(resolveUnits('c', 'en-US')).toBe('c');
  });

  it('converts', () => {
    expect(formatTemp(20, 'f')).toBe(68);
    expect(formatTemp(-3.6, 'c')).toBe(-4);
    expect(formatWind(16.09344, 'f')).toBe('10 mph');
    expect(formatWind(10, 'c')).toBe('10 km/h');
  });

  it('describes weather codes', () => {
    expect(weatherInfo(0, true)).toEqual({ label: 'Clear', icon: '☀️' });
    expect(weatherInfo(0, false).icon).toBe('🌙');
    expect(weatherInfo(1234).label).toBe('Unknown');
  });
});
