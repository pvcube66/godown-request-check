'use client';
import ActionForm from '../master/ActionForm';
import { waitDaysAction } from './actions';

export default function WaitDaysForm({ days }: { days: number }) {
  return (
    <ActionForm action={waitDaysAction} submitLabel="Save" pendingLabel="Saving…">
      <label className="master-field">Days to wait for a new indent before alerting (1 to 30)<input name="days" type="number" min={1} max={30} defaultValue={days} required /></label>
    </ActionForm>
  );
}
