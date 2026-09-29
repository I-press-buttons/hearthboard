import { useEffect, useRef, useState } from 'react';
import {
  nudgeWidget,
  overlaps,
  WIDGET_DEFAULT_SIZE,
  WIDGET_TYPES,
  type Board,
  type BoardSummary,
  type UserDTO,
  type WidgetInstance,
  type WidgetType,
} from '@hearthboard/shared';
import { api } from '../api';
import { BoardCanvas } from '../board/BoardCanvas';
import { BoardSettings } from '../board/BoardSettings';
import { WidgetSettings } from '../board/WidgetSettings';
import { useMe } from '../components/Auth';
import { Modal, TopBar } from '../components/TopBar';
import { useLive } from '../live';
import { WIDGETS, WidgetView } from '../widgets/registry';

const newId = () => Math.random().toString(16).slice(2, 14);

/** Steps of undo kept per board. */
const HISTORY_LIMIT = 60;
/** Changes with the same merge key this close together are one undo step (typing, nudging). */
const MERGE_MS = 1500;

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

const SHORTCUTS: [string, string][] = [
  [`${MOD} Z`, 'Undo'],
  [`${MOD} Shift Z  or  ${MOD} Y`, 'Redo'],
  ['Arrow keys', 'Move the selected widget one square'],
  ['Shift + arrow keys', 'Make the selected widget bigger or smaller'],
  [`${MOD} D`, 'Duplicate the selected widget'],
  ['Delete or Backspace', 'Remove the selected widget'],
  ['Tab / Shift Tab', 'Select the next / previous widget'],
  ['Esc', 'Deselect and close panels'],
  ['?', 'Show these shortcuts'],
];

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([keys, what]) => (
            <tr key={keys}>
              <td>
                <kbd>{keys}</kbd>
              </td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">On a phone, use the ↶ and ↷ buttons at the top to undo and redo.</p>
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </Modal>
  );
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

/** The board to open: the one in the URL if it's yours to edit, else "main", else your first. */
export function pickBoard(boards: BoardSummary[], wanted: string | null): string | null {
  const ids = boards.map((b) => b.id);
  if (wanted && ids.includes(wanted)) return wanted;
  return ids.includes('main') ? 'main' : (ids[0] ?? null);
}

export function Editor() {
  const { user } = useMe();
  const admin = user.role === 'admin';
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [people, setPeople] = useState<UserDTO[]>([]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<'widget' | 'board' | null>(null);
  const [menu, setMenu] = useState(false);
  const [save, setSave] = useState<SaveState>('saved');
  const [error, setError] = useState<string | null>(null);
  const [hist, setHist] = useState<{ past: Board[]; future: Board[] }>({ past: [], future: [] });
  const lastMerge = useRef<{ key: string; at: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: boolean } | null>(null);
  const [help, setHelp] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveState = useRef<SaveState>('saved');
  saveState.current = save;

  const loadBoards = () => api.get<BoardSummary[]>('/api/boards').then(setBoards);
  const loadBoard = (id = boardId) =>
    id && api.get<Board>(`/api/boards/${id}`).then(setBoard, (e: Error) => setError(e.message));

  useEffect(() => {
    void loadBoards();
    if (admin) void api.get<UserDTO[]>('/api/users').then(setPeople);
  }, [admin]);
  // Once the list is in, open the board from the URL (if it's ours) or our first one.
  useEffect(() => {
    if (boards && !boardId)
      setBoardId(pickBoard(boards, new URLSearchParams(location.search).get('board')));
  }, [boards, boardId]);
  useEffect(() => {
    if (!boardId) return;
    setSelected(null);
    setPanel(null);
    setHist({ past: [], future: [] });
    lastMerge.current = null;
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Show and save a board, without touching undo history. */
  const commit = (next: Board) => {
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

  /**
   * Change the board and remember the old one for undo. Changes sharing a `merge` key within
   * a moment of each other (typing a title, nudging with arrow keys) undo as one step.
   */
  const update = (next: Board, merge?: string) => {
    if (board) {
      const now = Date.now();
      const prev = lastMerge.current;
      lastMerge.current = merge ? { key: merge, at: now } : null;
      if (!(merge && prev?.key === merge && now - prev.at < MERGE_MS)) {
        const before = board;
        setHist((h) => ({ past: [...h.past.slice(1 - HISTORY_LIMIT), before], future: [] }));
      }
    }
    commit(next);
  };

  const travel = (dir: 'undo' | 'redo') => {
    if (!board) return;
    const from = dir === 'undo' ? hist.past : hist.future;
    if (!from.length) return;
    const target = dir === 'undo' ? from[from.length - 1] : from[0];
    setHist(
      dir === 'undo'
        ? { past: hist.past.slice(0, -1), future: [board, ...hist.future] }
        : { past: [...hist.past, board], future: hist.future.slice(1) },
    );
    lastMerge.current = null;
    setToast(null);
    commit(target);
    if (selected && !target.widgets.some((w) => w.id === selected)) {
      setSelected(null);
      setPanel(null);
    }
  };

  const importLayout = async (file: File) => {
    try {
      const layout = JSON.parse(await file.text()) as unknown;
      const b = await api.post<Board>('/api/boards', { layout });
      await loadBoards();
      setBoardId(b.id);
      setToast({ text: `Imported “${b.name}” as a new board.`, undo: false });
    } catch (e) {
      setError(
        e instanceof SyntaxError ? 'That file is not a Hearthboard layout.' : (e as Error).message,
      );
    }
  };

  // Keyboard shortcuts (see SHORTCUTS). Re-bound every render so they see the current board.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .modal')) return;
      if (!board) return;
      // Tab, arrows and Delete act on widgets only when focus isn't on a button or link.
      const onCanvas = target === document.body || !!target?.closest('.editor-canvas');
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (mod && key === 'z') {
        e.preventDefault();
        travel(e.shiftKey ? 'redo' : 'undo');
      } else if (mod && key === 'y') {
        e.preventDefault();
        travel('redo');
      } else if (e.key === '?') {
        setHelp(true);
      } else if (key === 'Escape') {
        setSelected(null);
        setPanel(null);
        setMenu(false);
      } else if (!onCanvas) {
        return;
      } else if (key === 'Tab' && !mod && board.widgets.length) {
        e.preventDefault();
        const i = board.widgets.findIndex((w) => w.id === selected);
        const n = board.widgets.length;
        const next =
          board.widgets[(i + (e.shiftKey ? n - 1 : 1) + (i < 0 && e.shiftKey ? 1 : 0)) % n];
        setSelected(next.id);
        setPanel('widget');
      } else if (selected) {
        const sel = board.widgets.find((w) => w.id === selected);
        if (!sel) return;
        if (key === 'Delete' || key === 'Backspace') {
          e.preventDefault();
          removeWidget(sel.id);
        } else if (mod && key === 'd') {
          e.preventDefault();
          duplicate(sel);
        } else if (key.startsWith('Arrow') && !mod) {
          e.preventDefault();
          const step = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          }[key];
          if (!step) return;
          const [a, b] = step;
          const widgets = nudgeWidget(
            board,
            sel.id,
            e.shiftKey ? { dw: a, dh: b } : { dx: a, dy: b },
          );
          if (widgets) update({ ...board, widgets }, `nudge:${sel.id}`);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (boards && !boards.length)
    return <div className="widget-empty">You don't have a board yet. Ask an admin for one.</div>;
  if (!board) return <div className="widget-empty">{error ?? 'Loading…'}</div>;

  // On a portrait phone, size the canvas to the board so the space below stays usable.
  const portrait =
    window.innerWidth < 800 && window.innerHeight > window.innerWidth && board.width > board.height;
  const canvasHeight = Math.round(((window.innerWidth - 12) * board.height) / board.width) + 12;

  const selectedWidget = board.widgets.find((w) => w.id === selected) ?? null;
  const updateWidget = (id: string, patch: Partial<WidgetInstance>, merge?: string) =>
    update(
      { ...board, widgets: board.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) },
      merge,
    );

  function removeWidget(id: string) {
    if (!board) return;
    update({ ...board, widgets: board.widgets.filter((w) => w.id !== id) });
    setSelected(null);
    setPanel(null);
    setToast({ text: 'Widget removed.', undo: true });
  }

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

  function duplicate(w: WidgetInstance) {
    if (!board) return;
    const spot = findSpot({ ...board }, w.type);
    if (!spot) return setError('There is no free space for a copy.');
    const copy = { ...w, ...spot, w: Math.min(w.w, spot.w), h: Math.min(w.h, spot.h), id: newId() };
    update({ ...board, widgets: [...board.widgets, copy] });
    setSelected(copy.id);
  }

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
    const left = await api.get<BoardSummary[]>('/api/boards');
    setBoards(left);
    setBoardId(pickBoard(left, null));
  };

  const setOwner = async (ownerId: string) => {
    await api.put(`/api/boards/${board.id}/owner`, { ownerId });
    await loadBoards();
  };

  const list = boards ?? [];
  const current = list.find((b) => b.id === board.id);
  // Admins see everyone's boards, grouped by whose they are.
  const owners = [...new Set(list.map((b) => b.ownerId))];
  const option = (b: BoardSummary) => (
    <option key={b.id} value={b.id}>
      {b.name}
    </option>
  );

  return (
    <div className="app">
      <TopBar active="edit">
        <select
          value={boardId ?? board.id}
          onChange={(e) =>
            e.target.value === '__new' ? void newBoard() : setBoardId(e.target.value)
          }
          className="board-picker"
          style={{ width: 'auto' }}
        >
          {owners.length > 1
            ? owners.map((o) => {
                const theirs = list.filter((b) => b.ownerId === o);
                const label = o === user.id ? 'My boards' : (theirs[0].ownerName ?? 'Nobody');
                return (
                  <optgroup key={o ?? ''} label={label}>
                    {theirs.map(option)}
                  </optgroup>
                );
              })
            : list.map(option)}
          <option value="__new">+ New board…</option>
        </select>
        <div style={{ position: 'relative' }}>
          <button className="btn primary" onClick={() => setMenu((m) => !m)}>
            + Add<span className="hide-sm"> widget</span>
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
        <button
          className="btn ghost"
          title={`Undo (${MOD} Z)`}
          aria-label="Undo"
          disabled={!hist.past.length}
          onClick={() => travel('undo')}
        >
          ↶
        </button>
        <button
          className="btn ghost"
          title={`Redo (${MOD} Shift Z)`}
          aria-label="Redo"
          disabled={!hist.future.length}
          onClick={() => travel('redo')}
        >
          ↷
        </button>
        <button
          className="btn ghost hide-sm"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          onClick={() => setHelp(true)}
        >
          ⌨︎
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
              onChange={(config) =>
                updateWidget(selectedWidget.id, { config }, `config:${selectedWidget.id}`)
              }
              onTextSize={(textSize) => updateWidget(selectedWidget.id, { textSize })}
              onDelete={() => removeWidget(selectedWidget.id)}
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
              onChange={(b) => update(b, 'board-settings')}
              boards={list}
              onImport={(file) => void importLayout(file)}
              onClose={() => setPanel(null)}
              onDelete={
                list.filter((b) => b.ownerId === current?.ownerId).length > 1
                  ? () => void deleteBoard()
                  : undefined
              }
              owner={
                admin && current
                  ? { id: current.ownerId, people, onChange: (id) => void setOwner(id) }
                  : undefined
              }
            />
          </div>
        )}
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast.text}
          {toast.undo && hist.past.length > 0 && (
            <button className="btn small" onClick={() => travel('undo')}>
              Undo
            </button>
          )}
        </div>
      )}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </div>
  );
}
