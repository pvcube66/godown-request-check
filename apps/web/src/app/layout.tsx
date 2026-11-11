import type { ReactNode } from 'react';
import '@fontsource-variable/geist';
import './globals.css';

export const metadata = {
  metadataBase: new URL('https://vivtejhostelanamoly.vercel.app'),
  title: { default: 'Godown Request Check', template: '%s · Godown Request Check' },
  description: 'Spots goods requests that are much bigger than usual.',
};
export const viewport = { themeColor: '#0a0a0a' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Sets light or dark before anything is painted, so there is no flash: the saved choice, otherwise the device setting. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t)}catch(e){}" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
