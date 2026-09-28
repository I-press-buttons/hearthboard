import {
  RESOLUTION_PRESETS,
  TEXT_SIZES,
  THEMES,
  type Board,
  type TextSizeId,
  type ThemeId,
} from '@hearthboard/shared';

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
}: {
  board: Board;
  onChange: (b: Board) => void;
  onClose: () => void;
  onDelete?: () => void;
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
