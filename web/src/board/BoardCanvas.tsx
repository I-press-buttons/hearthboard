import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import GridLayout, { type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  WIDGET_DEFAULT_SIZE,
  getTheme,
  themeCssVars,
  type Board,
  type WidgetInstance,
} from '@hearthboard/shared';

export interface WidgetSize {
  width: number;
  height: number;
}

interface Props {
  board: Board;
  editable?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onLayout?: (widgets: WidgetInstance[]) => void;
  renderWidget: (w: WidgetInstance, size: WidgetSize) => ReactNode;
  /** Pixel offset applied to the stage (burn-in protection). */
  shift?: { x: number; y: number };
}

/** On-screen pixel size of a widget at `scale`, using the same maths as react-grid-layout. */
export function widgetPixels(board: Board, w: { w: number; h: number }, scale = 1): WidgetSize {
  const m = board.margin * scale;
  const colW = (board.width * scale - m * (board.cols + 1)) / board.cols;
  const rowH = (board.height * scale - m * (board.rows + 1)) / board.rows;
  return {
    width: Math.round(colW * w.w + m * (w.w - 1)),
    height: Math.round(rowH * w.h + m * (w.h - 1)),
  };
}

/**
 * The board laid out for a target resolution (e.g. 1920×1080) and scaled to fit
 * whatever screen shows it: the TV at 1:1, a phone at a fraction. The grid itself
 * is resized (not CSS-transformed) so libraries like FullCalendar measure real pixels.
 */
export function BoardCanvas({
  board,
  editable,
  selectedId,
  onSelect,
  onLayout,
  renderWidget,
  shift,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = box.w && box.h ? Math.min(box.w / board.width, box.h / board.height) : 0;
  const width = Math.floor(board.width * scale);
  const height = Math.floor(board.height * scale);
  const margin = board.margin * scale;
  const offsetX = Math.max(0, (box.w - width) / 2);
  const offsetY = editable ? 0 : Math.max(0, (box.h - height) / 2);
  const rowHeight = (height - margin * (board.rows + 1)) / board.rows;
  const fontSize = (Math.min(board.width, board.height) / 1080) * 20 * scale;

  const layout: Layout[] = useMemo(
    () =>
      board.widgets.map((w) => ({
        i: w.id,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        minW: WIDGET_DEFAULT_SIZE[w.type].minW,
        minH: WIDGET_DEFAULT_SIZE[w.type].minH,
      })),
    [board.widgets],
  );

  const byId = useMemo(() => new Map(board.widgets.map((w) => [w.id, w])), [board.widgets]);

  // Keep a stable reference to the latest widgets for layout callbacks.
  const widgetsRef = useRef(board.widgets);
  useEffect(() => {
    widgetsRef.current = board.widgets;
  }, [board.widgets]);

  const commit = (next: Layout[]) => {
    if (!onLayout) return;
    const pos = new Map(next.map((l) => [l.i, l]));
    const updated = widgetsRef.current.map((w) => {
      const l = pos.get(w.id);
      return l ? { ...w, x: l.x, y: l.y, w: l.w, h: l.h } : w;
    });
    const changed = updated.some((w, i) => {
      const o = widgetsRef.current[i];
      return w.x !== o.x || w.y !== o.y || w.w !== o.w || w.h !== o.h;
    });
    if (changed) onLayout(updated);
  };

  return (
    <div
      ref={viewport}
      className={`board-viewport theme-${board.theme} ${editable ? 'edit-mode' : ''}`}
      style={
        {
          ...themeCssVars(getTheme(board.theme)),
          '--accent': board.accent,
        } as CSSProperties
      }
      onPointerDown={(e) => {
        if (editable && e.target === e.currentTarget) onSelect?.(null);
      }}
    >
      {scale > 0 && (
        <div
          className="board-stage"
          style={{
            width,
            height,
            left: offsetX + (shift?.x ?? 0),
            top: offsetY + (shift?.y ?? 0),
            fontSize,
            ['--radius' as string]: `${Math.max(4, 18 * scale)}px`,
          }}
          onPointerDown={(e) => {
            if (editable && (e.target as HTMLElement).classList.contains('react-grid-layout'))
              onSelect?.(null);
          }}
        >
          <GridLayout
            layout={layout}
            cols={board.cols}
            rowHeight={rowHeight}
            width={width}
            margin={[margin, margin]}
            containerPadding={[margin, margin]}
            maxRows={board.rows}
            compactType={null}
            preventCollision
            isBounded
            isDraggable={!!editable}
            isResizable={!!editable}
            draggableHandle=".drag-handle"
            resizeHandles={['se', 'e', 's', 'w', 'sw']}
            onDragStop={commit}
            onResizeStop={commit}
            style={{ height }}
            autoSize={false}
          >
            {board.widgets.map((w) => (
              <div
                key={w.id}
                className={w.id === selectedId ? 'is-selected' : undefined}
                onPointerDown={() => editable && onSelect?.(w.id)}
              >
                {renderWidget(byId.get(w.id)!, widgetPixels(board, w, scale))}
              </div>
            ))}
          </GridLayout>
        </div>
      )}
    </div>
  );
}
