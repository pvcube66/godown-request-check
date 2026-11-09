'use client';
import { useRef, useTransition } from 'react';
import { setAnomalyStatuses } from '@/app/(app)/actions';
import { Icon } from './Icons';
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

  const apply = (status: Status, undoTo?: Status) => start(async () => {
    const card = root.current?.closest('.flag');
    card?.classList.add('leaving');
    try {
      await setAnomalyStatuses(keys, status);
      showToast({
        message: DONE_TEXT[status],
        undo: status === 'open' ? undefined : async () => { await setAnomalyStatuses(keys, undoTo ?? 'open'); },
      });
    } catch {
      card?.classList.remove('leaving');
      showToast({ message: 'That did not save. Please try again.', tone: 'bad' });
    }
  });

  return (
    <div className="actions" ref={root} aria-busy={pending}>
      {mode === 'open' ? (
        <>
          <button className="btn problem" disabled={pending} onClick={() => apply('confirmed')}><Icon name="alert" size={18} />This looks wrong</button>
          <button className="btn fine" disabled={pending} onClick={() => apply('ignored')}><Icon name="check" size={18} />This is fine</button>
          <button className="btn quiet" disabled={pending} onClick={() => apply('expected')} title="Use this when the hostel really needs this much, for example more students or a festival.">It is normal for this hostel</button>
        </>
      ) : (
        <button className="btn" disabled={pending} onClick={() => apply('open')}><Icon name="undo" size={18} />Move back to “To check”</button>
      )}
    </div>
  );
}
