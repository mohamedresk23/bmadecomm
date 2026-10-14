'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { adminNavigationMetadata, isAdminRouteActive, type AdminNavItem } from './admin-navigation';

const paths: Record<string, string> = {
  home: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
  box: 'm12 3 9 5v9l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v9',
  tree: 'M12 3v7 M5 14v7h5v-7Z M14 14v7h5v-7Z M5 14v-4h14v4',
  settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  shield: 'M12 3 3 6v6c0 5 9 9 9 9s9-4 9-9V6Z m-4 9 3 3 5-5',
};
function Icon({ name }: { name: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] ?? paths.home} /></svg>;
}

export function AdminShell({ items, children }: { items: AdminNavItem[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const sidebarHadFocus = useRef(false);
  const previousOverflow = useRef<string | null>(null);
  function restoreScroll() {
    if (previousOverflow.current !== null) { document.body.style.overflow = previousOverflow.current; previousOverflow.current = null; }
  }
  function positionTooltip(event: SyntheticEvent<HTMLElement>) {
    const tooltip = event.currentTarget.querySelector<HTMLElement>('.admin-tooltip');
    const rect = event.currentTarget.getBoundingClientRect();
    if (tooltip) { tooltip.style.top = `${rect.top}px`; tooltip.style.right = `${window.innerWidth - rect.left + 8}px`; }
  }

  function closeDrawer() { dialog.current?.close(); restoreScroll(); setOpen(false); }
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const resize = () => {
      if (media.matches && dialog.current?.open) { dialog.current.close(); restoreScroll(); setOpen(false); collapseButton.current?.focus(); }
      else if (!media.matches && (sidebarHadFocus.current || sidebar.current?.contains(document.activeElement))) { sidebarHadFocus.current = false; opener.current?.focus(); }
    };
    media.addEventListener('change', resize);
    return () => { media.removeEventListener('change', resize); restoreScroll(); };
  }, []);
  useEffect(() => {
    if (open) {
      if (previousOverflow.current === null) previousOverflow.current = document.body.style.overflow;
      document.body.style.overflow = 'hidden'; dialog.current?.showModal(); closeButton.current?.focus();
    } else { if (dialog.current?.open) dialog.current.close(); restoreScroll(); }
  }, [open]);
  useEffect(() => { dialog.current?.close(); }, [pathname]);
  function navigation(mobile = false) {
    const groups = [...new Set(items.map(item => adminNavigationMetadata[item.href]?.group ?? 'الإدارة'))];
    return <nav aria-label="التنقل الإداري">{groups.map(group => <section className="admin-nav-group" key={group}>
      <h2 className="admin-group-title">{group}</h2>
      <ul>{items.filter(item => (adminNavigationMetadata[item.href]?.group ?? 'الإدارة') === group).map(item => {
        const meta = adminNavigationMetadata[item.href];
        const label = meta?.label ?? item.label;
        return <li key={item.href}><Link href={item.href} aria-label={label} aria-current={isAdminRouteActive(pathname, item.href) ? 'page' : undefined} className="admin-nav-link" onFocus={positionTooltip} onMouseEnter={positionTooltip} onClick={mobile ? closeDrawer : undefined}>
          <Icon name={meta?.icon ?? 'home'} /><span className="admin-nav-label">{label}</span><span className="admin-tooltip" aria-hidden="true">{label}</span>
        </Link></li>;
      })}</ul>
    </section>)}</nav>;
  }
  return <div className={`admin-workspace ${collapsed ? 'admin-collapsed' : ''}`} dir="rtl">
    <a className="admin-skip" href="#admin-content">انتقل إلى المحتوى</a>
    <aside ref={sidebar} className="admin-sidebar" aria-label="القائمة الجانبية" onFocusCapture={() => { sidebarHadFocus.current = true; }} onBlurCapture={event => {
      // Hiding the sidebar can clear activeElement before the media callback.
      // Keep its focus history when blur has no destination; clear real transfers.
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) sidebarHadFocus.current = false;
    }}>
      <div className="admin-brand"><span aria-hidden="true">BM</span><strong>إدارة المتجر</strong></div>
      <button ref={collapseButton} className="admin-control admin-collapse-control" type="button" aria-expanded={!collapsed} aria-label={collapsed ? 'توسيع القائمة' : 'طي القائمة'} onFocus={positionTooltip} onMouseEnter={positionTooltip} onClick={event => { positionTooltip(event); setCollapsed(!collapsed); }}><span aria-hidden="true">{collapsed ? '←' : '→'}</span><span className="admin-nav-label">طي القائمة</span><span className="admin-tooltip" aria-hidden="true">توسيع القائمة</span></button>
      {navigation()}
    </aside>
    <div className="admin-body"><div className="admin-mobile-bar"><strong>إدارة المتجر</strong><button ref={opener} className="admin-control" aria-haspopup="dialog" aria-expanded={open} aria-controls="admin-mobile-menu" onClick={() => setOpen(true)}>فتح القائمة</button></div>
      <main id="admin-content" tabIndex={-1} className="admin-content">{children}</main>
    </div>
    <dialog id="admin-mobile-menu" ref={dialog} className="admin-drawer" aria-labelledby="admin-menu-title" onCancel={event => { event.preventDefault(); closeDrawer(); }} onClose={() => { restoreScroll(); setOpen(false); if (!window.matchMedia('(min-width: 1024px)').matches) opener.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDrawer(); } }}>
      <div className="admin-drawer-heading"><h2 id="admin-menu-title">التنقل الإداري</h2><button ref={closeButton} className="admin-control" onClick={closeDrawer}>إغلاق القائمة</button></div>{navigation(true)}
    </dialog>
  </div>;
}
