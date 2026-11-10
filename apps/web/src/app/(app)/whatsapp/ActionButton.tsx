'use client';
import { useActionState } from 'react';
import type { MasterActionState } from '../master/action-state';

export default function ActionButton({ action, label, pending: pendingLabel }: { action: () => Promise<MasterActionState>; label: string; pending: string }) {
  const [state, run, pending] = useActionState(async () => action(), {} as MasterActionState);
  return (
    <form action={run} className="master-form" aria-busy={pending}>
      <button className="master-button" type="submit" disabled={pending}>{pending ? pendingLabel : label}</button>
      {state.error && <p className="master-message master-error" role="alert">{state.error}</p>}
      {state.success && <p className="master-message" role="status">{state.success}</p>}
    </form>
  );
}
