import type { ReactNode } from 'react';

export function TopBar({
  children,
  active,
}: {
  children?: ReactNode;
  active: 'edit' | 'calendar' | 'family' | 'settings';
}) {
  const link = (href: string, label: string, key: typeof active) => (
    <a className={`btn ${active === key ? '' : 'ghost'}`} href={href}>
      {label}
    </a>
  );
  return (
    <div className="topbar">
      <a className="brand" href="/edit">
        <img src="/favicon.svg" alt="" />
        <span className="hide-sm">Hearthboard</span>
      </a>
      {link('/edit', 'Layout', 'edit')}
      {link('/calendar', 'Calendar', 'calendar')}
      {link('/family', 'Family', 'family')}
      {link('/settings', 'Settings', 'settings')}
      {children}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
