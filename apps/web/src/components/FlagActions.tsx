'use client';
import { useRef, useState, useTransition } from 'react';
import { setAnomalyStatuses } from '@/app/(app)/actions';
import { Icon } from './Icons';
import Spinner from './Spinner';
import { showToast } from './toast';

type Status = 'open' | 'confirmed' | 'ignored' | 'expected';
const DONE_TEXT: Record<Status, string> = {
  confirmed: 'Marked as wrong. It moved to “Marked wrong”.',
  ignored: 'Marked as fine. It moved to “Marked fine”.',
  expected: 'Saved as normal for this hostel. It moved to “Marked fine”.',
  open: 'Moved back to “To check”.',
};

/** Buttons for one flag (or a group of flags). The card fades away right after you click, and you can undo. */
export default function FlagActions({ keys, mode }: { keys: string[]; mode: 'open' | 'done' }) {
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<Status | null>(null);

  const apply = (status: Status, undoTo?: Status) => {
    setBusy(status);                             // shown straight away, not held back until the save finishes
    start(async () => {
    const card = root.current?.closest<HTMLElement>('.flag');
    if (card) {                                   // fix the card at its real height first, so it can shrink smoothly to nothing
      card.style.maxHeight = `${card.offsetHeight}px`;
      void card.offsetHeight;
      card.classList.add('leaving');
    }
    try {
      await setAnomalyStatuses(keys, status);
      showToast({
        message: DONE_TEXT[status],
        undo: status === 'open' ? undefined : async () => { await setAnomalyStatuses(keys, undoTo ?? 'open'); },
      });
    } catch {
      card?.classList.remove('leaving');
      if (card) card.style.maxHeight = '';
      showToast({ message: 'That did not save. Please try again.', tone: 'bad' });
    } finally { setBusy(null); }
    });
  };

  return (
    <div className="actions" ref={root} aria-busy={pending}>
      {mode === 'open' ? (
        <>
          <button className="btn problem" disabled={pending} onClick={() => apply('confirmed')}>{busy === 'confirmed' ? <Spinner /> : <Icon name="alert" size={18} />}{busy === 'confirmed' ? 'Saving…' : 'This looks wrong'}</button>
          <button className="btn fine" disabled={pending} onClick={() => apply('ignored')}>{busy === 'ignored' ? <Spinner /> : <Icon name="check" size={18} />}{busy === 'ignored' ? 'Saving…' : 'This is fine'}</button>
          <button className="btn quiet" disabled={pending} onClick={() => apply('expected')} title="Use this when the hostel really needs this much, for example more students or a festival.">{busy === 'expected' ? <><Spinner size={14} />Saving…</> : 'It is normal for this hostel'}</button>
        </>
      ) : (
        <button className="btn" disabled={pending} onClick={() => apply('open')}>{busy === 'open' ? <Spinner /> : <Icon name="undo" size={18} />}{busy === 'open' ? 'Moving…' : 'Move back to “To check”'}</button>
      )}
    </div>
  );
}
