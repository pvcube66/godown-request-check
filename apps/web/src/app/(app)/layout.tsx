import type { ReactNode } from 'react';
import { Suspense } from 'react';
import AppShell from '@/components/AppShell';
import Toaster from '@/components/Toaster';
import TopLoader from '@/components/TopLoader';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}><TopLoader /></Suspense>
      <a href="#main" className="skip">Skip to the content</a>
      <AppShell>{children}</AppShell>
      <Toaster />
    </>
  );
}
