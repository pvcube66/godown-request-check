import type { ReactNode } from 'react';
import { Suspense } from 'react';
import AppShell from '@/components/AppShell';
import Toaster from '@/components/Toaster';
import TopLoader from '@/components/TopLoader';
import { requireViewer } from '@/lib/viewer';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer();
  return (
    <>
      <Suspense fallback={null}><TopLoader /></Suspense>
      <a href="#main" className="skip">Skip to the content</a>
      <AppShell user={{ name: viewer.name, role: viewer.role }}>{children}</AppShell>
      <Toaster />
    </>
  );
}
