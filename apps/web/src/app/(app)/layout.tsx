import type { ReactNode } from 'react';
import Link from 'next/link';
import { logoutAction } from '../login/actions';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="top">
        <Link href="/" className="brand-link">Godown Request Check</Link>
        <nav aria-label="Main">
          <Link href="/">Unusual requests</Link>
          <Link href="/accounts">Godowns</Link>
          <Link href="/runs">Past checks</Link>
        </nav>
        <form action={logoutAction}><button className="linkish">Sign out</button></form>
      </header>
      <main>{children}</main>
    </>
  );
}
