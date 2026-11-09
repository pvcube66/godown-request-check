import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Godown Request Check' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
