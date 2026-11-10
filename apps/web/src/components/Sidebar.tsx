'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo, Icon } from '@/components/Icons';
import { logoutAction } from '@/app/login/actions';

export type SidebarProps = {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  user: { name: string; role: 'admin' | 'operator' | 'viewer' };
};

const LINKS = [
  { href: '/', label: 'Unusual requests', icon: 'alert', admin: false },
  { href: '/accounts', label: 'Godowns', icon: 'warehouse', admin: true },
  { href: '/dashboards', label: 'Dashboards', icon: 'chart', admin: false },
  { href: '/orders', label: 'Order tracking', icon: 'truck', admin: false },
  { href: '/suppliers', label: 'Supplier performance', icon: 'scale', admin: false },
  { href: '/issues', label: 'Issues', icon: 'flag', admin: false },
  { href: '/master', label: 'Master data', icon: 'pencil', admin: true },
  { href: '/users', label: 'Users', icon: 'user', admin: true },
  { href: '/exports', label: 'Full copy', icon: 'download', admin: true },
  { href: '/runs', label: 'Past checks', icon: 'clock', admin: true },
] as const;

const ROLE_TEXT = { admin: 'Administrator', operator: 'Operator', viewer: 'View only' } as const;

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  user,
}: SidebarProps) {
  const path = usePathname();

  const handleLinkClick = () => {
    if (mobileOpen) {
      onCloseMobile();
    }
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="sidebar-backdrop noprint"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={`sidebar noprint ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
        aria-label="Main Navigation"
      >
        <div className="sidebar-head">
          <Link
            href="/"
            className="sidebar-brand"
            onClick={handleLinkClick}
            title="Godown Request Check"
          >
            <Logo size={28} />
            <span className="sidebar-brand-text">Godown Request Check</span>
          </Link>

          {/* Desktop collapse toggle */}
          <button
            type="button"
            className="collapse-toggle desktop-only"
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={18} />
          </button>

          {/* Mobile close button */}
          <button
            type="button"
            className="collapse-toggle mobile-only"
            onClick={onCloseMobile}
            title="Close menu"
            aria-label="Close menu"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          {LINKS.filter((l) => !l.admin || user.role === 'admin').map(({ href, label, icon }) => {
            const on =
              href === '/'
                ? path === '/' || path.startsWith('/hostel') || path.startsWith('/report')
                : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={handleLinkClick}
                className={`sidebar-link ${on ? 'on' : ''}`}
                aria-current={on ? 'page' : undefined}
                title={label}
              >
                <span className="sidebar-icon">
                  <Icon name={icon} size={20} />
                </span>
                <span className="sidebar-label">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <p className="sidebar-user" title={`${user.name} · ${ROLE_TEXT[user.role]}`}><b>{user.name}</b><span>{ROLE_TEXT[user.role]}</span></p>
          <form action={logoutAction}>
            <button
              type="submit"
              className="sidebar-signout"
              title="Sign out"
              aria-label="Sign out"
            >
              <span className="sidebar-icon">
                <Icon name="signout" size={20} />
              </span>
              <span className="sidebar-label">Sign out</span>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
