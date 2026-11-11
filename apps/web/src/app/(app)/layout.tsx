import type { ReactNode } from 'react';
import { Suspense } from 'react';
import AppShell from '@/components/AppShell';
import Toaster from '@/components/Toaster';
import TopLoader from '@/components/TopLoader';
import { requireViewer } from '@/lib/viewer';
import { getDb } from '@/lib/db';
import { getWhatsAppSettings, isConnected } from '@anomaly/core';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer();
  const waConnected = viewer.role === 'admin' ? isConnected(await getWhatsAppSettings(await getDb())) : false;
  return (
    <>
      <Suspense fallback={null}><TopLoader /></Suspense>
      <a href="#main" className="skip">Skip to the content</a>
      <AppShell user={{ name: viewer.name, role: viewer.role }} waConnected={waConnected}>{children}</AppShell>
      <Toaster />
    </>
  );
}
