'use client';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { setAnomalyStatuses } from '@/app/(app)/actions';
import { raiseIssueAction } from '@/app/(app)/issues/actions';
import { Icon } from './Icons';
import Spinner from './Spinner';
import { showToast } from './toast';

type Status = 'open' | 'confirmed' | 'ignored' | 'expected';
const DONE_TEXT: Record<'ignored' | 'open', string> = {
  ignored: 'Marked as fine. It moved to “Marked fine”.',
  open: 'Moved back to “To check”.',
};

/** Buttons for one flag (or a group of flags).
 *  Issue = we record that this indent is wrong and follow it until the hostel sends a new one. The operator rejects on the real portal; this system never does.
 *  Fine = nothing is wrong. */
export default function FlagActions({ keys, mode, issueId }: { keys: string[]; mode: 'open' | 'confirmed' | 'fine'; issueId?: string }) {
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'issue' | 'ignored' | 'open' | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const leave = () => {
    const card = root.current?.closest<HTMLElement>('.flag');
    if (card) { card.style.maxHeight = `${card.offsetHeight}px`; void card.offsetHeight; card.classList.add('leaving'); }
    return card;
  };
  const stay = (card?: HTMLElement | null) => { card?.classList.remove('leaving'); if (card) card.style.maxHeight = ''; };

  const setStatus = (status: 'ignored' | 'open', undoTo?: Status) => {
    setBusy(status);
    start(async () => {
      const card = leave();
      try {
        await setAnomalyStatuses(keys, status);
        showToast({ message: DONE_TEXT[status], undo: status === 'open' ? undefined : async () => { await setAnomalyStatuses(keys, undoTo ?? 'open'); } });
      } catch { stay(card); showToast({ message: 'That did not save. Please try again.', tone: 'bad' }); }
      finally { setBusy(null); }
    });
  };

  const raise = () => {
    setError(''); setBusy('issue');
    start(async () => {
      const res = await raiseIssueAction(keys, reason);
      setBusy(null);
      if (!res.ok) { setError(res.message); return; }
      const card = leave(); void card;
      showToast({ message: res.message });
    });
  };

  if (mode === 'confirmed') {
    return <div className="actions" ref={root}>{issueId ? <Link className="btn" href={`/issues/${issueId}`}><Icon name="flag" size={18} /> See the issue</Link> : <span className="mut small">Marked wrong earlier, before issues were recorded.</span>}</div>;
  }
  if (mode === 'fine') {
    return <div className="actions" ref={root} aria-busy={pending}><button className="btn" disabled={pending} onClick={() => setStatus('open')}>{busy === 'open' ? <Spinner /> : <Icon name="undo" size={18} />}{busy === 'open' ? 'Moving…' : 'Move back to “To check”'}</button></div>;
  }
  return (
    <div className="actions" ref={root} aria-busy={pending}>
      <button className="btn problem" disabled={pending} aria-expanded={asking} onClick={() => setAsking((a) => !a)} title="Record that this indent is wrong. You then reject it on the government portal.">
        <Icon name="flag" size={18} />Issue (reject this indent)
      </button>
      <button className="btn fine" disabled={pending} onClick={() => setStatus('ignored')} title="Nothing is wrong with this request.">{busy === 'ignored' ? <Spinner /> : <Icon name="check" size={18} />}{busy === 'ignored' ? 'Saving…' : 'Fine'}</button>
      {asking && (
        <div className="issue-raise">
          <label htmlFor={`why-${keys[0]}`}><b>What is wrong?</b> (required)</label>
          <textarea id={`why-${keys[0]}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={2} placeholder="For example: sugar is typed as 300, it should be 30" />
          <p className="issue-note">This only records the issue here. It does not change anything on the government portal. After this, reject the indent on the portal yourself; we will see it within the hour and then wait for the hostel’s new indent.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div><button className="btn problem" disabled={pending || reason.trim().length < 3} onClick={raise}>{busy === 'issue' ? <><Spinner size={14} />Saving…</> : 'Record the issue'}</button> <button className="btn quiet" disabled={pending} onClick={() => setAsking(false)}>Cancel</button></div>
        </div>
      )}
    </div>
  );
}
