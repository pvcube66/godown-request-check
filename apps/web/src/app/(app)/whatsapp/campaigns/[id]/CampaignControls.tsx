'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Loader from '@/components/Loader';
import { showToast } from '@/components/toast';
import { changeCampaignAction, retryFailedAction, tickCampaignAction } from '../actions';

export default function CampaignControls({ id, status, failed }: { id: string; status: string; failed: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const act = (a: string) => start(async () => { const r = a === 'retry' ? await retryFailedAction(id) : await changeCampaignAction(id, a); showToast({ message: r.ok ? r.message : r.message, ...(r.ok ? {} : { tone: 'bad' as const }) }); router.refresh(); });

  // While the campaign is running and this page is open, send the next small batch every few seconds.
  useEffect(() => {
    if (status !== 'running') return;
    let stop = false, busy = false;
    const tick = async () => {
      if (stop || busy || document.visibilityState !== 'visible') return;
      busy = true;
      try { const r = await tickCampaignAction(id); if (r.ok) { setNote(r.result.note ?? ''); router.refresh(); if (r.result.state === 'done' || r.result.state === 'paused') stop = true; } } finally { busy = false; }
    };
    void tick(); const t = setInterval(() => { if (stop) clearInterval(t); else void tick(); }, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [id, status, router]);

  return (
    <div className="send-actions">
      {status === 'draft' && <button className="btn primary-ish" disabled={pending} onClick={() => { if (confirm('Start this campaign now? Messages begin to go out right away if WhatsApp is live.')) act('start'); }}>Start campaign</button>}
      {status === 'running' && <button className="btn" disabled={pending} onClick={() => act('pause')}>{pending ? <Loader size="sm" label="" /> : null}Pause</button>}
      {status === 'paused' && <button className="btn primary-ish" disabled={pending} onClick={() => act('resume')}>Resume</button>}
      {(status === 'draft' || status === 'running' || status === 'paused') && <button className="btn problem" disabled={pending} onClick={() => { if (confirm('Cancel this campaign? People still waiting will not be messaged.')) act('cancel'); }}>Cancel</button>}
      {failed > 0 && status !== 'draft' && status !== 'cancelled' && <button className="btn" disabled={pending} onClick={() => act('retry')}>Retry {failed} not sent</button>}
      {status === 'running' && <span className="mut small">Sending… keep this page open, or the hourly job continues it.{note ? ` ${note}` : ''}</span>}
    </div>
  );
}
