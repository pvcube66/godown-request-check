'use client';

import { useEffect, useState, useTransition } from 'react';
import { forceRefreshAction } from '@/app/(app)/actions';
import { ago, when } from '@/lib/format';
import { showToast } from '@/components/toast';

/** "Last updated" with a Force refresh button, shown at the top of every page. */
export default function ForceRefresh({ lastUpdated }: { lastUpdated: string | null }) {
  const [pending, start] = useTransition();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);
  const d = lastUpdated ? new Date(lastUpdated) : null;
  const run = () => start(async () => {
    const r = await forceRefreshAction();
    showToast({ message: r.message, tone: r.ok ? 'ok' : 'bad' });
  });
  return (
    <div className="force-refresh" role="group" aria-label="Data freshness">
      <span className="mut small" title={d ? when(d) : undefined} suppressHydrationWarning>Last updated {d ? `${when(d)} (${ago(d)})` : 'never'}</span>
      <button type="button" onClick={run} disabled={pending} aria-busy={pending}>{pending ? 'Refreshing… (can take a few minutes)' : 'Force refresh'}</button>
    </div>
  );
}
