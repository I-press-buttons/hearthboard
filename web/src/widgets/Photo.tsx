import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../api';
import { useLive } from '../live';
import type { WidgetProps } from './types';

interface Slide {
  src: string;
  caption: string;
  key: number;
}

export function PhotoWidget({ config, size }: WidgetProps<'photo'>) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);
  // Request pixels for the physical screen, not the scaled board.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(size.width * dpr);
  const h = Math.round(size.height * dpr);
  const sizeRef = useRef({ w, h });
  sizeRef.current = { w, h };

  const advance = useRef<() => void>(() => {});
  advance.current = async () => {
    try {
      const next = await api.get<{ id: string | null; caption: string }>(
        `/api/photos/next${qs({ source: config.source, folder: config.folder, albumId: config.albumId })}`,
      );
      if (!next.id) {
        setError(
          config.source === 'folder'
            ? 'No photos found in the photo folder.'
            : 'That album is empty.',
        );
        return;
      }
      const src = `/api/photos/img/${next.id}${qs({ w: sizeRef.current.w, h: sizeRef.current.h })}`;
      // Preload so the crossfade never shows a half-loaded image.
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = img.onerror = () => resolve();
        img.src = src;
      });
      setError(null);
      setSlides((prev) => [
        ...prev.slice(-1),
        { src, caption: next.caption, key: ++counter.current },
      ]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void advance.current();
    const t = setInterval(() => void advance.current(), config.intervalSec * 1000);
    return () => clearInterval(t);
  }, [config.source, config.folder, config.albumId, config.intervalSec]);

  useLive(['photos'], () => void advance.current());

  if (error && !slides.length) return <div className="widget-empty">{error}</div>;

  return (
    <div className="photo">
      {slides.map((s, i) => (
        <img
          key={s.key}
          src={s.src}
          alt=""
          className={config.kenBurns ? 'kenburns' : ''}
          style={{ objectFit: config.fit, opacity: i === slides.length - 1 ? 1 : 0 }}
        />
      ))}
      {config.showCaption && slides.at(-1)?.caption && (
        <div className="photo-caption">{slides.at(-1)!.caption}</div>
      )}
    </div>
  );
}
