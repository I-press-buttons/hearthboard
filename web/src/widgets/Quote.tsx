import { textScale, type QuoteDTO } from '@hearthboard/shared';
import { api, qs } from '../api';
import { useLiveQuery } from '../live';
import type { WidgetProps } from './types';

/** Pick a font size that fills the box without overflowing, from the text length. */
export function fitFont(width: number, height: number, chars: number, scale = 1): number {
  const area = width * height * 0.42;
  const fs = Math.sqrt(area / (Math.max(24, chars) * 0.75));
  return Math.max(4, Math.min(fs, height * 0.22, width * 0.09)) * scale;
}

export function QuoteWidget({ config, size, board, widget }: WidgetProps<'quote'>) {
  const { data } = useLiveQuery(
    ['quotes'],
    () => api.get<QuoteDTO>(`/api/quote${qs({ mode: config.mode, rotate: config.rotate })}`),
    [config.mode, config.rotate],
    5 * 60_000,
  );
  if (!data) return null;
  const fs = fitFont(
    size.width,
    size.height,
    data.text.length + data.source.length / 2,
    config.fontScale * textScale(board, widget),
  );
  return (
    <div className="quote" style={{ fontSize: fs }}>
      <div className="quote-text">{data.kind === 'verse' ? data.text : `“${data.text}”`}</div>
      {data.source && <div className="quote-source">— {data.source}</div>}
    </div>
  );
}
