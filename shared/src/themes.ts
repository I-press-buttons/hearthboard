/**
 * Board color themes and text sizes.
 *
 * Everything the wall display uses for color and type size is defined here, so
 * adding or tweaking a theme is a one-file change:
 *
 *  - To change a theme, edit its colors below.
 *  - To add a theme, copy an entry, give it a new key and label. It appears in
 *    Board settings automatically and is accepted by the API.
 *  - To change or add a text size, edit TEXT_SIZES the same way.
 *
 * Keep the existing keys (boards store the key), or saved boards fall back to
 * the default.
 */

export interface ThemeColors {
  /** Page background behind the widgets. */
  bg: string;
  /** Widget panel fill (can be translucent). */
  panel: string;
  /** Opaque panel color, used for popovers and editor chrome on the board. */
  panelSolid: string;
  /** Widget border and calendar grid lines. */
  panelBorder: string;
  /** Main text. */
  text: string;
  /** Secondary text: dates, titles, labels. */
  muted: string;
  /** Tertiary text: empty states, past days. */
  faint: string;
  /** Faint wash used for alternate calendar cells and hover rows. */
  wash: string;
}

export interface ThemeDef {
  label: string;
  /** 'dark' or 'light': tells the browser which native controls and scrollbars to draw. */
  scheme: 'dark' | 'light';
  /** Accent picked when someone switches to this theme (they can still change it). */
  accent: string;
  colors: ThemeColors;
}

export const THEMES = {
  dark: {
    label: 'Ember (dark, best for TVs)',
    scheme: 'dark',
    accent: '#f59e0b',
    colors: {
      bg: '#0b0f14',
      panel: 'rgba(255, 255, 255, 0.055)',
      panelSolid: '#141a22',
      panelBorder: 'rgba(255, 255, 255, 0.08)',
      text: '#f4f1ea',
      muted: 'rgba(244, 241, 234, 0.62)',
      faint: 'rgba(244, 241, 234, 0.35)',
      wash: 'rgba(255, 255, 255, 0.04)',
    },
  },
  light: {
    label: 'Linen (light)',
    scheme: 'light',
    accent: '#d97706',
    colors: {
      bg: '#f5f1ea',
      panel: 'rgba(255, 255, 255, 0.78)',
      panelSolid: '#ffffff',
      panelBorder: 'rgba(40, 30, 20, 0.1)',
      text: '#1f1a14',
      muted: 'rgba(31, 26, 20, 0.62)',
      faint: 'rgba(31, 26, 20, 0.38)',
      wash: 'rgba(40, 30, 20, 0.04)',
    },
  },
  midnight: {
    label: 'Midnight (deep blue)',
    scheme: 'dark',
    accent: '#60a5fa',
    colors: {
      bg: '#070b1a',
      panel: 'rgba(96, 130, 255, 0.07)',
      panelSolid: '#10172e',
      panelBorder: 'rgba(148, 170, 255, 0.12)',
      text: '#e8edff',
      muted: 'rgba(214, 222, 255, 0.64)',
      faint: 'rgba(214, 222, 255, 0.36)',
      wash: 'rgba(148, 170, 255, 0.05)',
    },
  },
  forest: {
    label: 'Forest (dark green)',
    scheme: 'dark',
    accent: '#4ade80',
    colors: {
      bg: '#08120d',
      panel: 'rgba(120, 200, 150, 0.065)',
      panelSolid: '#122019',
      panelBorder: 'rgba(160, 220, 180, 0.11)',
      text: '#eaf5ee',
      muted: 'rgba(220, 240, 228, 0.63)',
      faint: 'rgba(220, 240, 228, 0.35)',
      wash: 'rgba(160, 220, 180, 0.045)',
    },
  },
  sunrise: {
    label: 'Sunrise (warm light)',
    scheme: 'light',
    accent: '#ea580c',
    colors: {
      bg: '#fdeee4',
      panel: 'rgba(255, 250, 245, 0.82)',
      panelSolid: '#fffaf5',
      panelBorder: 'rgba(120, 50, 20, 0.12)',
      text: '#2b1508',
      muted: 'rgba(60, 28, 10, 0.64)',
      faint: 'rgba(60, 28, 10, 0.38)',
      wash: 'rgba(234, 88, 12, 0.05)',
    },
  },
  slate: {
    label: 'Slate (cool light)',
    scheme: 'light',
    accent: '#2563eb',
    colors: {
      bg: '#e8ecf1',
      panel: 'rgba(255, 255, 255, 0.85)',
      panelSolid: '#ffffff',
      panelBorder: 'rgba(30, 41, 59, 0.12)',
      text: '#0f172a',
      muted: 'rgba(15, 23, 42, 0.62)',
      faint: 'rgba(15, 23, 42, 0.38)',
      wash: 'rgba(30, 41, 59, 0.04)',
    },
  },
  contrast: {
    label: 'High contrast',
    scheme: 'dark',
    accent: '#facc15',
    colors: {
      bg: '#000000',
      panel: '#000000',
      panelSolid: '#000000',
      panelBorder: 'rgba(255, 255, 255, 0.55)',
      text: '#ffffff',
      muted: 'rgba(255, 255, 255, 0.85)',
      faint: 'rgba(255, 255, 255, 0.6)',
      wash: 'rgba(255, 255, 255, 0.08)',
    },
  },
} as const satisfies Record<string, ThemeDef>;

export type ThemeId = keyof typeof THEMES;
export const THEME_IDS = Object.keys(THEMES) as [ThemeId, ...ThemeId[]];
export const DEFAULT_THEME: ThemeId = 'dark';

/**
 * Text sizes. `scale` multiplies every widget's text (1 = the original size).
 * Set per board, and optionally overridden per widget.
 */
export const TEXT_SIZES = {
  xs: { label: 'Extra small', scale: 0.8 },
  s: { label: 'Small', scale: 0.9 },
  m: { label: 'Medium', scale: 1 },
  l: { label: 'Large', scale: 1.2 },
  xl: { label: 'Extra large', scale: 1.45 },
} as const satisfies Record<string, { label: string; scale: number }>;

export type TextSizeId = keyof typeof TEXT_SIZES;
export const TEXT_SIZE_IDS = Object.keys(TEXT_SIZES) as [TextSizeId, ...TextSizeId[]];
export const DEFAULT_TEXT_SIZE: TextSizeId = 'm';

/** Look up a theme, falling back to the default for unknown keys. */
export function getTheme(id: string | undefined): ThemeDef {
  return (THEMES as Record<string, ThemeDef>)[id ?? ''] ?? THEMES[DEFAULT_THEME];
}

/** Text multiplier for a widget: its own size if set, otherwise the board's. */
export function textScale(board: { textSize?: string }, widget?: { textSize?: string }): number {
  const sizes = TEXT_SIZES as Record<string, { scale: number }>;
  const id = widget?.textSize ?? board.textSize ?? DEFAULT_TEXT_SIZE;
  return (sizes[id] ?? TEXT_SIZES[DEFAULT_TEXT_SIZE]).scale;
}

/** CSS custom properties for a theme, ready to spread into a `style` prop. */
export function themeCssVars(theme: ThemeDef): Record<string, string> {
  const c = theme.colors;
  return {
    '--bg': c.bg,
    '--panel': c.panel,
    '--panel-solid': c.panelSolid,
    '--panel-border': c.panelBorder,
    '--text': c.text,
    '--muted': c.muted,
    '--faint': c.faint,
    '--wash': c.wash,
    colorScheme: theme.scheme,
  };
}
