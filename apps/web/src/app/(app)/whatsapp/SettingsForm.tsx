'use client';
import ActionForm from '../master/ActionForm';
import { saveSettingsAction } from './actions';

export default function SettingsForm(p: { phoneNumberId: string; wabaId: string; hasToken: boolean; hasSecret: boolean; mode: string; firstAfterDays: number; everyDays: number; maxMessages: number }) {
  return (
    <ActionForm action={saveSettingsAction} submitLabel="Save" pendingLabel="Saving…">
      <div className="master-fields">
        <label className="master-field">Phone number ID (from Meta)<input name="phoneNumberId" defaultValue={p.phoneNumberId} inputMode="numeric" maxLength={25} /></label>
        <label className="master-field">WhatsApp business account ID (from Meta)<input name="wabaId" defaultValue={p.wabaId} inputMode="numeric" maxLength={25} /></label>
        <label className="master-field">Access key {p.hasToken && <span className="mut">(saved; leave blank to keep it)</span>}<input name="accessToken" type="password" autoComplete="new-password" maxLength={1000} placeholder={p.hasToken ? '••••••••' : ''} /></label>
        <label className="master-field">App secret {p.hasSecret && <span className="mut">(saved; leave blank to keep it)</span>}<input name="appSecret" type="password" autoComplete="new-password" maxLength={200} placeholder={p.hasSecret ? '••••••••' : ''} /></label>
        <label className="master-field">First reminder after this many days in transit<input name="firstAfterDays" type="number" min={1} max={30} defaultValue={p.firstAfterDays} required /></label>
        <label className="master-field">Days between reminders<input name="everyDays" type="number" min={1} max={30} defaultValue={p.everyDays} required /></label>
        <label className="master-field">Number of reminders (1 to 4)<input name="maxMessages" type="number" min={1} max={4} defaultValue={p.maxMessages} required /></label>
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
