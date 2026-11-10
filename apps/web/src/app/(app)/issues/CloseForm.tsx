'use client';
import ActionForm from '../master/ActionForm';
import { closeIssueAction } from './actions';

export default function CloseForm({ issueId }: { issueId: string }) {
  return (
    <ActionForm action={closeIssueAction} submitLabel="Close this issue" pendingLabel="Closing…">
      <input type="hidden" name="issueId" value={issueId} />
      <label className="master-field master-span">Why is it being closed without a new indent?<textarea name="note" required maxLength={1000} rows={2} /></label>
    </ActionForm>
  );
}
