'use client';

import { useState, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { Logo, Icon } from '@/components/Icons';

export default function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
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
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={handleToggleCollapse}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
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
        </header>

        <main id="main">{children}</main>

        <footer className="foot noprint">
          Data comes from the Telangana welfare portal and is checked every hour.
        </footer>
      </div>
    </div>
  );
}
