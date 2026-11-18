'use client';

import { Fragment } from 'react';
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
  waConnected?: boolean;
};

const LINKS = [
  { href: '/dashboards', label: 'Dashboard', icon: 'chart', admin: false },
  { href: '/orders', label: 'Stage Wise', icon: 'truck', admin: false },
  { href: '/', label: 'Unusual Requests', icon: 'alert', admin: false },
  { href: '/suppliers', label: 'Supplier Performance', icon: 'scale', admin: false },
  { href: '/issues', label: 'Issues', icon: 'flag', admin: false },
  { href: '/indents', label: 'Indents', icon: 'file', admin: false },
  { href: '/accounts', label: 'Godowns', icon: 'warehouse', admin: true },
  { href: '/master', label: 'Master data', icon: 'pencil', admin: true },
  { href: '/users', label: 'Users', icon: 'user', admin: true },
  { href: '/exports', label: 'Full copy', icon: 'download', admin: true },
  { href: '/runs', label: 'Past checks', icon: 'clock', admin: true },
] as const;

const ROLE_TEXT = { admin: 'Administrator', operator: 'Operator', viewer: 'View only' } as const;

const SETTINGS_PATHS = ['/whatsapp/settings', '/whatsapp/templates', '/whatsapp/connect'];
export default function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  user,
  waConnected = false,
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
          {LINKS.filter((l) => !l.admin || user.role === 'admin').map(({ href, label, icon, admin }, i, all) => {
            const on =
              href === '/'
                ? path === '/' || path.startsWith('/hostel') || path.startsWith('/report')
                : path.startsWith(href);
            return (
              <Fragment key={href}>
              {admin && !all[i - 1]?.admin && <span className="sidebar-group">Admin</span>}
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
              </Fragment>
            );
          })}
          {user.role === 'admin' && (
            <>
              <span className="sidebar-group">WhatsApp Cloud API</span>
              {(waConnected ? [{ href: '/whatsapp/people', label: 'People', icon: 'user', exact: false }, { href: '/whatsapp/chats', label: 'Chats', icon: 'chat', exact: false }, { href: '/whatsapp/send', label: 'Send message', icon: 'chat', exact: false }, { href: '/whatsapp/campaigns', label: 'Campaigns', icon: 'chat', exact: false }, { href: '/whatsapp/stats', label: 'Stats', icon: 'chart', exact: false }, { href: '/whatsapp/settings', label: 'Settings', icon: 'shield', exact: false }] : [{ href: '/whatsapp/connect', label: 'Connect WhatsApp', icon: 'plug', exact: false }]).map(({ href, label, icon, exact }) => {
                const on = href === '/whatsapp/settings' ? (path === '/whatsapp' || SETTINGS_PATHS.some((x) => path === x || path.startsWith(`${x}/`))) : exact ? path === href : path.startsWith(href);
                return (
                  <Link key={href} href={href} onClick={handleLinkClick} className={`sidebar-link ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined} title={label}>
                    <span className="sidebar-icon"><Icon name={icon} size={20} /></span>
                    <span className="sidebar-label">{label}</span>
                  </Link>
                );
              })}
            </>
          )}
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
