'use client';

import { useActionState, type ReactNode } from 'react';
import type { MasterActionState } from './action-state';

export default function ActionForm({ action, children, submitLabel, pendingLabel = 'Saving…', disabled = false }: {
  action: (state: MasterActionState, form: FormData) => Promise<MasterActionState>;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="master-form" aria-busy={pending}>
      {children}
      <div className="master-form-footer">
        <button className="master-button" type="submit" disabled={pending || disabled}>{pending ? pendingLabel : submitLabel}</button>
      </div>
      {state.error && <p className="master-message master-error" role="alert">{state.error}</p>}
      {state.success && <p className="master-message" role="status">{state.success}</p>}
    </form>
  );
}
