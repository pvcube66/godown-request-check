'use client';
import ActionForm from '../master/ActionForm';
import { saveSettingsAction } from './actions';

export default function SettingsForm(p: { mode: string; firstAfterDays: number; everyDays: number; maxMessages: number }) {
  return (
    <ActionForm action={saveSettingsAction} submitLabel="Save" pendingLabel="Saving…">
      <div className="master-fields">
        <label className="master-field">First reminder after this many days in transit<input name="firstAfterDays" type="number" min={1} max={30} defaultValue={p.firstAfterDays} required /></label>
        <label className="master-field">Days between reminders<input name="everyDays" type="number" min={1} max={30} defaultValue={p.everyDays} required /></label>
        <label className="master-field">Number of reminders (0 = keep going until the order leaves In-Transit)<input name="maxMessages" type="number" min={0} max={50} defaultValue={p.maxMessages} required /></label>
        <label className="master-field master-span">What should happen
          <select name="mode" defaultValue={p.mode}>
            <option value="off">Off: do nothing</option>
            <option value="dry_run">Preview only: work out who would be messaged, send nothing</option>
            <option value="live">Live: send the reminders</option>
          </select>
        </label>
      </div>
    </ActionForm>
  );
}
