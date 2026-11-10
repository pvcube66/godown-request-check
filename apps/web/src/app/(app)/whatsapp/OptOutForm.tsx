'use client';
import ActionForm from '../master/ActionForm';
import { optOutAction } from './actions';

export default function OptOutForm({ godownId, hostelCode, optedOut }: { godownId: number; hostelCode: string; optedOut: boolean }) {
  return (
    <ActionForm action={optOutAction} submitLabel={optedOut ? 'Switch reminders back on' : 'Record: hostel asked us to stop'} pendingLabel="Saving…">
      <input type="hidden" name="godownId" value={godownId} /><input type="hidden" name="hostelCode" value={hostelCode} /><input type="hidden" name="stop" value={optedOut ? '0' : '1'} />
    </ActionForm>
  );
}
