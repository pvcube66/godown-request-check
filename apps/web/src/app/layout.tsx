import type { ReactNode } from 'react';
import '@fontsource-variable/figtree';
import './globals.css';

export const metadata = {
  metadataBase: new URL('https://vivtejhostels.vercel.app'),
  title: { default: 'Godown Request Check', template: '%s · Godown Request Check' },
  description: 'Spots goods requests that are much bigger than usual.',
};
export const viewport = { themeColor: '#0a5c63' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
