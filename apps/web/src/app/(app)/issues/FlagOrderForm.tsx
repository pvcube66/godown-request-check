'use client';
import ActionForm from '../master/ActionForm';
import { flagOrderAction } from './actions';

export default function FlagOrderForm({ requestId }: { requestId: string }) {
  return (
    <ActionForm action={flagOrderAction} submitLabel="Flag this order" pendingLabel="Saving…">
      <input type="hidden" name="requestId" value={requestId} />
      <label className="master-field master-span">Why does this order need attention?<textarea name="reason" required maxLength={1000} rows={2} /></label>
    </ActionForm>
  );
}
