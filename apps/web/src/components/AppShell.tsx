'use client';

import ThemeToggle from './ThemeToggle';
import { useState, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { Logo, Icon } from '@/components/Icons';

export default function AppShell({ children, user, waConnected = false }: { children: ReactNode; user: { name: string; role: 'admin' | 'operator' | 'viewer' }; waConnected?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
    const [density, setDensity] = useState<'compact' | 'comfortable'>('compact');

  useEffect(() => {
    try {
      const savedDensity = localStorage.getItem('dashboard_density');
            if (savedDensity === 'comfortable') setDensity('comfortable');
            const saved = localStorage.getItem('sidebar_collapsed');
      if (saved === 'true') {
        setCollapsed(true);
      }
    } catch {
      // Local storage not accessible
    }
  }, []);

  const handleToggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sidebar_collapsed', String(next));
      } catch {
        // Local storage not accessible
      }
      return next;
    });
  };

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`} data-density={density}>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={handleToggleCollapse}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        user={user}
        waConnected={waConnected}
      />

      <div className="app-main">
        {/* Mobile header shown only on small screens */}
        <header className="mobile-header noprint">
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
          >
            <Icon name="menu" size={22} />
          </button>
          <Link href="/" className="mobile-brand">
            <Logo size={26} />
            <span>Godown Request Check</span>
          </Link>
          <span className="mobile-spacer" />
          <ThemeToggle />
        </header>

        <header className="workspace-header noprint">
          <form action="/search" className="global-search" role="search" aria-label="Search all hostels and orders">
            <label htmlFor="global-query"><Icon name="search" size={18} /><span className="sr-only">Find a hostel or order</span></label>
            <input id="global-query" name="q" type="search" maxLength={60} placeholder="Hostel name, code or request ID" autoComplete="off" />
            <button type="submit">Search</button>
          </form>
          <ThemeToggle />
        </header>

        <main id="main">{children}</main>

        <footer className="foot noprint">
          Data comes from the Telangana welfare portal and is checked every hour.
        </footer>
      </div>
    </div>
  );
}
