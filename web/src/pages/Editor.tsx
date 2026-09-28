import { useEffect, useRef, useState } from 'react';
import {
  WIDGET_DEFAULT_SIZE,
  WIDGET_TYPES,
  type Board,
  type WidgetInstance,
  type WidgetType,
} from '@hearthboard/shared';
import { api } from '../api';
import { BoardCanvas } from '../board/BoardCanvas';
import { BoardSettings } from '../board/BoardSettings';
import { WidgetSettings } from '../board/WidgetSettings';
import { TopBar } from '../components/TopBar';
import { useLive } from '../live';
import { WIDGETS, WidgetView } from '../widgets/registry';

const newId = () => Math.random().toString(16).slice(2, 14);

function overlaps(a: { x: number; y: number; w: number; h: number }, b: typeof a) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** First free spot for a widget, shrinking it towards its minimum size if needed. */
export function findSpot(
  board: Board,
  type: WidgetType,
): { x: number; y: number; w: number; h: number } | null {
  const d = WIDGET_DEFAULT_SIZE[type];
  for (
    let w = Math.min(d.w, board.cols), h = Math.min(d.h, board.rows);
    w >= d.minW && h >= d.minH;
  ) {
    for (let y = 0; y + h <= board.rows; y++) {
      for (let x = 0; x + w <= board.cols; x++) {
        const r = { x, y, w, h };
        if (!board.widgets.some((o) => overlaps(r, o))) return r;
      }
    }
    if (w > d.minW) w--;
    else h--;
  }
  return null;
}

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

export function Editor() {
  const [boards, setBoards] = useState<{ id: string; name: string }[]>([]);
  const [boardId, setBoardId] = useState(
    () => new URLSearchParams(location.search).get('board') || 'main',
  );
  const [board, setBoard] = useState<Board | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<'widget' | 'board' | null>(null);
  const [menu, setMenu] = useState(false);
  const [save, setSave] = useState<SaveState>('saved');
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveState = useRef<SaveState>('saved');
  saveState.current = save;

  const loadBoards = () => api.get<{ id: string; name: string }[]>('/api/boards').then(setBoards);
  const loadBoard = (id = boardId) =>
    api.get<Board>(`/api/boards/${id}`).then(setBoard, (e: Error) => setError(e.message));

  useEffect(() => {
    void loadBoards();
  }, []);
  useEffect(() => {
    setSelected(null);
    setPanel(null);
    void loadBoard(boardId);
    const url = new URL(location.href);
    if (boardId === 'main') url.searchParams.delete('board');
    else url.searchParams.set('board', boardId);
    history.replaceState(null, '', url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  // Pick up edits made from another phone or PC, unless we have unsaved changes.
  useLive(['board'], () => {
    if (saveState.current === 'saved') void loadBoard();
    void loadBoards();
  });

  const update = (next: Board) => {
    setBoard(next);
    setSave('dirty');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSave('saving');
      try {
        await api.put(`/api/boards/${next.id}`, next);
        setSave('saved');
        setError(null);
      } catch (e) {
        setSave('error');
        setError((e as Error).message);
      }
    }, 500);
  };

  if (!board) return <div className="widget-empty">{error ?? 'Loading…'}</div>;

  // On a portrait phone, size the canvas to the board so the space below stays usable.
  const portrait =
    window.innerWidth < 800 && window.innerHeight > window.innerWidth && board.width > board.height;
  const canvasHeight = Math.round(((window.innerWidth - 12) * board.height) / board.width) + 12;

  const selectedWidget = board.widgets.find((w) => w.id === selected) ?? null;
  const updateWidget = (id: string, patch: Partial<WidgetInstance>) =>
    update({ ...board, widgets: board.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) });

  const addWidget = (type: WidgetType) => {
    setMenu(false);
    const spot = findSpot(board, type);
    if (!spot) {
      setError('There is no free space. Shrink or remove a widget first.');
      return;
    }
    const w: WidgetInstance = { id: newId(), type, ...spot, config: {} };
    update({ ...board, widgets: [...board.widgets, w] });
    setSelected(w.id);
    setPanel('widget');
  };

  const duplicate = (w: WidgetInstance) => {
    const spot = findSpot({ ...board }, w.type);
    if (!spot) return setError('There is no free space for a copy.');
    const copy = { ...w, ...spot, w: Math.min(w.w, spot.w), h: Math.min(w.h, spot.h), id: newId() };
    update({ ...board, widgets: [...board.widgets, copy] });
    setSelected(copy.id);
  };

  const newBoard = async () => {
    const name = prompt('Name for the new board (e.g. Kitchen, Kids room)');
    if (!name) return;
    const b = await api.post<Board>('/api/boards', { name, copyFrom: board.id });
    await loadBoards();
    setBoardId(b.id);
  };

  const deleteBoard = async () => {
    if (!confirm(`Delete the board “${board.name}”?`)) return;
    await api.del(`/api/boards/${board.id}`);
    await loadBoards();
    setBoardId('main');
  };

  return (
    <div className="app">
      <TopBar active="edit">
        <select
          value={boardId}
          onChange={(e) =>
            e.target.value === '__new' ? void newBoard() : setBoardId(e.target.value)
          }
          style={{ width: 'auto', maxWidth: 160 }}
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
          <option value="__new">+ New board…</option>
        </select>
        <div style={{ position: 'relative' }}>
          <button className="btn primary" onClick={() => setMenu((m) => !m)}>
            + Add widget
          </button>
          {menu && (
            <div className="menu">
              {WIDGET_TYPES.map((t) => (
                <button key={t} onClick={() => addWidget(t)}>
                  <span>{WIDGETS[t].icon}</span> {WIDGETS[t].label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="btn"
          onClick={() => {
            setSelected(null);
            setPanel(panel === 'board' ? null : 'board');
          }}
        >
          ⚙︎ <span className="hide-sm">Board</span>
        </button>
        <span className="spacer" />
        <span className="save-state">
          {save === 'saving'
            ? 'Saving…'
            : save === 'dirty'
              ? 'Unsaved'
              : save === 'error'
                ? '⚠ Not saved'
                : 'Saved'}
        </span>
        <a
          className="btn ghost hide-sm"
          href={board.id === 'main' ? '/' : `/?board=${board.id}`}
          target="_blank"
          rel="noreferrer"
        >
          Open display ↗
        </a>
      </TopBar>
      {error && (
        <div className="error-text" style={{ padding: '6px 14px' }} onClick={() => setError(null)}>
          {error}
        </div>
      )}
      <div className="editor-main" style={portrait ? { flexDirection: 'column' } : undefined}>
        <div
          className="editor-canvas"
          onClick={() => setMenu(false)}
          style={portrait ? { flex: 'none', height: canvasHeight } : undefined}
        >
          <BoardCanvas
            board={board}
            editable
            selectedId={selected}
            onSelect={(id) => {
              setSelected(id);
              setPanel(id ? 'widget' : null);
            }}
            onLayout={(widgets) => update({ ...board, widgets })}
            renderWidget={(w, size) => (
              <WidgetView
                widget={w}
                size={size}
                mode="edit"
                board={board}
                selected={w.id === selected}
              />
            )}
          />
        </div>
        {portrait && !panel && (
          <div className="rotate-hint">
            Tap a widget to select it, then drag its ⠿ pill to move or its corner to resize. Turning
            your phone sideways gives you a bigger board.
          </div>
        )}
        {panel === 'widget' && selectedWidget && (
          <div className="drawer">
            <WidgetSettings
              key={selectedWidget.id}
              widget={selectedWidget}
              onChange={(config) => updateWidget(selectedWidget.id, { config })}
              onTextSize={(textSize) => updateWidget(selectedWidget.id, { textSize })}
              onDelete={() => {
                update({
                  ...board,
                  widgets: board.widgets.filter((w) => w.id !== selectedWidget.id),
                });
                setSelected(null);
                setPanel(null);
              }}
              onDuplicate={() => duplicate(selectedWidget)}
              onClose={() => {
                setSelected(null);
                setPanel(null);
              }}
            />
          </div>
        )}
        {panel === 'board' && (
          <div className="drawer">
            <BoardSettings
              board={board}
              onChange={update}
              onClose={() => setPanel(null)}
              onDelete={boards.length > 1 ? () => void deleteBoard() : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}
