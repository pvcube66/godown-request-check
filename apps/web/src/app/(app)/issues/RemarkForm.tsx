'use client';
import ActionForm from '../master/ActionForm';
import { addRemarkAction } from './actions';

const OUTCOMES = [['', 'No call result'], ['reached', 'Spoke to them'], ['no_answer', 'No answer'], ['will_fix', 'They will fix it'], ['other', 'Other']] as const;

export default function RemarkForm({ targetType, targetId }: { targetType: 'issue' | 'order'; targetId: string }) {
  return (
    <ActionForm action={addRemarkAction} submitLabel="Add remark" pendingLabel="Saving…">
      <input type="hidden" name="targetType" value={targetType} /><input type="hidden" name="targetId" value={targetId} />
      <div className="master-fields">
        <label className="master-field master-span">Remark<textarea name="text" required maxLength={1000} rows={2} /></label>
        <label className="master-field">Call result (optional)<select name="outcome" defaultValue="">{OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
    </ActionForm>
  );
}
