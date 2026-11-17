import type { ReactNode } from 'react';
import { Suspense } from 'react';
import AppShell from '@/components/AppShell';
import Toaster from '@/components/Toaster';
import TopLoader from '@/components/TopLoader';
import { requireViewer } from '@/lib/viewer';
import { getDb } from '@/lib/db';
import { loadHealth } from '@/lib/health';
import { getWhatsAppSettings, isConnected } from '@anomaly/core';

export const maxDuration = 300;      // Force refresh runs a full check from inside the page

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer();
  const c = await getDb();
  const waConnected = viewer.role === 'admin' ? isConnected(await getWhatsAppSettings(c)) : false;
  const health = await loadHealth(c).catch(() => null);
  return (
    <>
      <Suspense fallback={null}><TopLoader /></Suspense>
      <a href="#main" className="skip">Skip to the content</a>
      <AppShell user={{ name: viewer.name, role: viewer.role }} waConnected={waConnected} lastUpdated={health?.lastSuccessAt?.toISOString() ?? null}>{children}</AppShell>
      <Toaster />
    </>
  );
}
