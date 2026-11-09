import type { ReactNode } from 'react';
import Link from 'next/link';
import { logoutAction } from '../login/actions';
import { Logo } from '@/components/Icons';
import NavLinks from '@/components/NavLinks';
import Toaster from '@/components/Toaster';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#main" className="skip">Skip to the content</a>
      <header className="top noprint">
        <div className="top-in">
          <Link href="/" className="brand-link"><Logo />Godown Request Check</Link>
          <NavLinks />
          <form action={logoutAction}><button className="signout">Sign out</button></form>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="foot noprint">Data comes from the Telangana welfare portal and is checked every hour.</footer>
      <Toaster />
    </>
  );
}
