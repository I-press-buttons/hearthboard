import {
  exportBoard,
  RESOLUTION_PRESETS,
  TEXT_SIZES,
  THEMES,
  type Board,
  type BoardScheduleEntry,
  type BoardSummary,
  type TextSizeId,
  type ThemeId,
  type UserDTO,
} from '@hearthboard/shared';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Save the board as a .json file (Board settings → Export layout). */
export function downloadLayout(board: Board) {
  const blob = new Blob([JSON.stringify(exportBoard(board), null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hearthboard-${board.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'board'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function ScheduleEditor({
  board,
  boards,
  onChange,
}: {
  board: Board;
  boards: BoardSummary[];
  onChange: (schedule: BoardScheduleEntry[]) => void;
}) {
  const others = boards.filter((b) => b.id !== board.id);
  const set = (i: number, patch: Partial<BoardScheduleEntry>) =>
    onChange(board.schedule.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  return (
    <div>
      {board.schedule.map((e, i) => (
        <div key={i} className="schedule-row">
          <div className="row">
            <select
              className="grow"
              aria-label="Board to show"
              value={e.boardId}
              onChange={(ev) => set(i, { boardId: ev.target.value })}
            >
              {!others.some((b) => b.id === e.boardId) && (
                <option value={e.boardId}>(a board that's gone)</option>
              )}
              {others.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.ownerName ? ` (${b.ownerName})` : ''}
                </option>
              ))}
            </select>
            <button
              className="btn small ghost"
              aria-label="Remove this time"
              onClick={() => onChange(board.schedule.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
          <div className="schedule-times">
            <input
              type="time"
              aria-label="From"
              value={e.start}
              onChange={(ev) => ev.target.value && set(i, { start: ev.target.value })}
            />
            <span className="hint" style={{ margin: 0 }}>
              until
            </span>
            <input
              type="time"
              aria-label="Until"
              value={e.end}
              onChange={(ev) => ev.target.value && set(i, { end: ev.target.value })}
            />
          </div>
          <div className="chips day-chips">
            {DAY_LETTERS.map((d, n) => {
              const on = e.days.includes(n);
              return (
                <span
                  key={n}
                  className={`chip ${on ? 'on' : ''}`}
                  title={DAY_NAMES[n]}
                  onClick={() =>
                    set(i, {
                      days: on ? e.days.filter((x) => x !== n) : [...e.days, n].sort(),
                    })
                  }
                >
                  {d}
                </span>
              );
            })}
            <span className="hint" style={{ margin: '0 0 0 4px' }}>
              {e.days.length ? '' : 'every day'}
            </span>
          </div>
        </div>
      ))}
      <button
        className="btn small"
        disabled={!others.length}
        onClick={() =>
          onChange([
            ...board.schedule,
            { boardId: others[0].id, start: '06:30', end: '08:30', days: [1, 2, 3, 4, 5] },
          ])
        }
      >
        + Add a time
      </button>
      {!others.length && <p className="hint">Make another board first (+ New board…).</p>}
    </div>
  );
}

/** Keep widgets inside the grid after the grid size changes. */
export function clampWidgets(b: Board): Board {
  return {
    ...b,
    widgets: b.widgets.map((w) => {
      const wi = Math.min(w.w, b.cols);
      const hi = Math.min(w.h, b.rows);
      return { ...w, w: wi, h: hi, x: Math.min(w.x, b.cols - wi), y: Math.min(w.y, b.rows - hi) };
    }),
  };
}

export function BoardSettings({
  board,
  onChange,
  onClose,
  onDelete,
  owner,
  boards = [],
  onImport,
}: {
  board: Board;
  onChange: (b: Board) => void;
  onClose: () => void;
  onDelete?: () => void;
  /** Boards this person can pick for the schedule. */
  boards?: BoardSummary[];
  /** Import a layout file as a new board. */
  onImport?: (file: File) => void;
  /** Admins only: whose board this is. */
  owner?: { id: string | null; people: UserDTO[]; onChange: (id: string) => void };
}) {
  const set = (patch: Partial<Board>) => onChange(clampWidgets({ ...board, ...patch }));
  const preset = RESOLUTION_PRESETS.findIndex(
    (p) => p.width === board.width && p.height === board.height,
  );

  return (
    <div>
      <h2>
        Board settings
        <span className="spacer" />
        <button className="btn small ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </h2>
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={board.name}
          onChange={(e) => set({ name: e.target.value || 'Board' })}
        />
      </label>
      {owner && (
        <label className="field">
          <span>Belongs to</span>
          <select value={owner.id ?? ''} onChange={(e) => owner.onChange(e.target.value)}>
            {!owner.id && <option value="">Nobody</option>}
            {owner.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Screen</span>
        <select
          value={preset}
          onChange={(e) => {
            const p = RESOLUTION_PRESETS[Number(e.target.value)];
            if (p) set({ width: p.width, height: p.height });
          }}
        >
          {RESOLUTION_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
          {preset < 0 && (
            <option value={-1}>
              Custom ({board.width}×{board.height})
            </option>
          )}
        </select>
      </label>
      <div className="row">
        <label className="field grow">
          <span>Width px</span>
          <input
            type="number"
            min={320}
            max={7680}
            value={board.width}
            onChange={(e) => set({ width: Number(e.target.value) || board.width })}
          />
        </label>
        <label className="field grow">
          <span>Height px</span>
          <input
            type="number"
            min={320}
            max={7680}
            value={board.height}
            onChange={(e) => set({ height: Number(e.target.value) || board.height })}
          />
        </label>
      </div>
      <div className="row">
        <label className="field grow">
          <span>Grid columns</span>
          <input
            type="number"
            min={4}
            max={64}
            value={board.cols}
            onChange={(e) => set({ cols: Math.max(4, Math.min(64, Number(e.target.value) || 24)) })}
          />
        </label>
        <label className="field grow">
          <span>Grid rows</span>
          <input
            type="number"
            min={4}
            max={64}
            value={board.rows}
            onChange={(e) => set({ rows: Math.max(4, Math.min(64, Number(e.target.value) || 16)) })}
          />
        </label>
      </div>
      <label className="field">
        <span>Gap between widgets (px)</span>
        <input
          type="number"
          min={0}
          max={64}
          value={board.margin}
          onChange={(e) => set({ margin: Math.max(0, Math.min(64, Number(e.target.value) || 0)) })}
        />
      </label>
      <div className="row">
        <label className="field grow">
          <span>Theme</span>
          <select
            value={board.theme}
            onChange={(e) => {
              const theme = e.target.value as ThemeId;
              set({ theme, accent: THEMES[theme].accent });
            }}
          >
            {(Object.keys(THEMES) as ThemeId[]).map((id) => (
              <option key={id} value={id}>
                {THEMES[id].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Accent</span>
          <input
            type="color"
            value={board.accent}
            onChange={(e) => set({ accent: e.target.value })}
          />
        </label>
      </div>
      <label className="field">
        <span>Text size</span>
        <select
          value={board.textSize}
          onChange={(e) => set({ textSize: e.target.value as TextSizeId })}
        >
          {(Object.keys(TEXT_SIZES) as TextSizeId[]).map((id) => (
            <option key={id} value={id}>
              {TEXT_SIZES[id].label}
            </option>
          ))}
        </select>
      </label>
      <label className="field inline">
        <span>Dim the screen at night</span>
        <input
          type="checkbox"
          checked={board.dim.enabled}
          onChange={(e) => set({ dim: { ...board.dim, enabled: e.target.checked } })}
        />
      </label>
      {board.dim.enabled && (
        <div className="row">
          <label className="field grow">
            <span>From</span>
            <input
              type="time"
              value={board.dim.start}
              onChange={(e) => set({ dim: { ...board.dim, start: e.target.value } })}
            />
          </label>
          <label className="field grow">
            <span>Until</span>
            <input
              type="time"
              value={board.dim.end}
              onChange={(e) => set({ dim: { ...board.dim, end: e.target.value } })}
            />
          </label>
          <label className="field grow">
            <span>Brightness</span>
            <select
              value={board.dim.level}
              onChange={(e) => set({ dim: { ...board.dim, level: Number(e.target.value) } })}
            >
              {[0.1, 0.25, 0.4, 0.6].map((l) => (
                <option key={l} value={l}>
                  {Math.round(l * 100)}%
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <label className="field inline">
        <span>Nudge the board a few pixels every few minutes (burn-in)</span>
        <input
          type="checkbox"
          checked={board.pixelShift}
          onChange={(e) => set({ pixelShift: e.target.checked })}
        />
      </label>
      <h3 className="drawer-section">Touch screen</h3>
      <label className="field inline">
        <span>Anyone at the screen can tick checklists and reminders (no sign-in)</span>
        <input
          type="checkbox"
          checked={board.interactive}
          onChange={(e) => set({ interactive: e.target.checked })}
        />
      </label>
      <label className="field inline">
        <span>Keep the screen awake</span>
        <input
          type="checkbox"
          checked={board.keepAwake}
          onChange={(e) => set({ keepAwake: e.target.checked })}
        />
      </label>
      <p className="hint">
        For a tablet on the wall. Only ticking works without signing in; nothing else can be changed
        from the screen. Keeping the screen awake needs the board opened over HTTPS.
      </p>
      <h3 className="drawer-section">Show another board at set times</h3>
      <p className="hint">
        e.g. a morning-routine board before school. Screens showing this board switch to the other
        one and back by themselves.
      </p>
      <ScheduleEditor board={board} boards={boards} onChange={(schedule) => set({ schedule })} />
      <h3 className="drawer-section">Layout file</h3>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn small" onClick={() => downloadLayout(board)}>
          Export layout
        </button>
        {onImport && (
          <label className="btn small">
            Import a layout…
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImport(file);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
      <p className="hint">
        Export saves this board's layout and widget settings as a file, to back it up or set up
        another Hearthboard. Import adds a file as a new board.
      </p>
      <p className="hint">
        Show this board on a screen by opening{' '}
        <code>{`${location.origin}/${board.id === 'main' ? '' : `?board=${board.id}`}`}</code> in
        its browser.
      </p>
      {onDelete && (
        <button className="btn danger" onClick={onDelete}>
          Delete this board
        </button>
      )}
    </div>
  );
}
