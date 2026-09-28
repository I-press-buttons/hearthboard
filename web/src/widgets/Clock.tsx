import { useEffect, useState } from 'react';
import type { WidgetProps } from './types';

export function ClockWidget({ config }: WidgetProps<'clock'>) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const h = now.getHours();
  const hours = config.hour24 ? String(h).padStart(2, '0') : String(h % 12 || 12);
  const mins = String(now.getMinutes()).padStart(2, '0');
  const secs = String(now.getSeconds()).padStart(2, '0');

  return (
    <div className="clock">
      <div className="clock-time">
        {hours}:{mins}
        {config.showSeconds && <span className="secs">{secs}</span>}
        {!config.hour24 && <span className="ampm">{h < 12 ? 'AM' : 'PM'}</span>}
      </div>
      {config.showDate && (
        <div className="clock-date">
          {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
      )}
    </div>
  );
}
