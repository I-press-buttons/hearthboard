import { describe, expect, it } from 'vitest';
import { Board, TEXT_SIZES, THEMES, getTheme, textScale, themeCssVars } from '../src';

describe('themes', () => {
  it('defines every color for every theme', () => {
    const keys = Object.keys(THEMES.dark.colors).sort();
    for (const [id, theme] of Object.entries(THEMES)) {
      expect(Object.keys(theme.colors).sort(), id).toEqual(keys);
      expect(theme.accent, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(Object.values(themeCssVars(theme)).every(Boolean), id).toBe(true);
    }
  });

  it('falls back to the default theme and text size for unknown keys', () => {
    const b = Board.parse({ id: 'x', name: 'X', theme: 'retired', textSize: 'huge' });
    expect(b.theme).toBe('dark');
    expect(b.textSize).toBe('m');
    expect(getTheme('nope')).toBe(THEMES.dark);
  });

  it('keeps old boards working', () => {
    const b = Board.parse({ id: 'x', name: 'X', theme: 'light' });
    expect(b.theme).toBe('light');
    expect(b.textSize).toBe('m');
  });
});

describe('text size', () => {
  it('uses the widget size when set, otherwise the board size', () => {
    expect(textScale({ textSize: 'l' })).toBe(TEXT_SIZES.l.scale);
    expect(textScale({ textSize: 'l' }, { textSize: 'xs' })).toBe(TEXT_SIZES.xs.scale);
    expect(textScale({ textSize: 'l' }, {})).toBe(TEXT_SIZES.l.scale);
    expect(textScale({})).toBe(1);
  });

  it('drops an unknown widget size instead of rejecting the board', () => {
    const b = Board.parse({
      id: 'x',
      name: 'X',
      widgets: [{ id: 'w', type: 'clock', x: 0, y: 0, w: 2, h: 2, textSize: 'giant' }],
    });
    expect(b.widgets[0].textSize).toBeUndefined();
  });
});
