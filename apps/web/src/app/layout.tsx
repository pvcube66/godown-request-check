import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata = { title: 'Godown Request Anomalies' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <strong>Godown Request Anomalies</strong>
          <nav><Link href="/">Flagged requests</Link><Link href="/accounts">Godown logins</Link><Link href="/runs">Run history</Link></nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
