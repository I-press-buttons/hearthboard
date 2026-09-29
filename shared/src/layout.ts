import type { Board, WidgetInstance } from './board';
import { WIDGET_DEFAULT_SIZE } from './widgets';

type Rect = { x: number; y: number; w: number; h: number };

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Move and/or resize one widget by whole grid cells (keyboard nudging in the editor).
 * Returns the updated widget list, or null when the change would leave the grid, overlap
 * another widget or shrink the widget below its minimum size.
 */
export function nudgeWidget(
  board: Pick<Board, 'cols' | 'rows' | 'widgets'>,
  id: string,
  d: { dx?: number; dy?: number; dw?: number; dh?: number },
): WidgetInstance[] | null {
  const w = board.widgets.find((x) => x.id === id);
  if (!w) return null;
  const min = WIDGET_DEFAULT_SIZE[w.type];
  const next = {
    ...w,
    x: w.x + (d.dx ?? 0),
    y: w.y + (d.dy ?? 0),
    w: w.w + (d.dw ?? 0),
    h: w.h + (d.dh ?? 0),
  };
  if (next.x < 0 || next.y < 0 || next.x + next.w > board.cols || next.y + next.h > board.rows)
    return null;
  if (next.w < min.minW || next.h < min.minH) return null;
  if (board.widgets.some((o) => o.id !== id && overlaps(next, o))) return null;
  return board.widgets.map((x) => (x.id === id ? next : x));
}
