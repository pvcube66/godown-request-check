'use server';

import { revalidatePath } from 'next/cache';
import { refreshTemplateStatus, saveWhatsAppSettings, submitReminderTemplate, WhatsAppApiError, WhatsAppInputError, getMetaFailureCopy, type SettingsPatch } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { actorOf, requireAccess } from '@/lib/viewer';
import type { MasterActionState } from '../master/action-state';

const str = (f: FormData, k: string, max = 1000) => {
  const v = f.get(k);
  if (v === null) return undefined;
  if (typeof v !== 'string' || v.length > max) throw new WhatsAppInputError(`Invalid ${k}`);
  return v;
};
const num = (f: FormData, k: string) => { const v = str(f, k, 6); return v === undefined || v.trim() === '' ? undefined : Number(v); };

function fail(e: unknown): { error: string } {
  if (e instanceof WhatsAppInputError) return { error: e.message };
  if (e instanceof WhatsAppApiError) { const c = getMetaFailureCopy(e.message); return { error: `WhatsApp said: ${c.title}. ${c.action}${c.code ? ` (code ${c.code})` : ''}` }; }
  return { error: 'Could not do this. Please sign in again if the page was left open, then try again.' };
}
const done = () => { revalidatePath('/whatsapp'); };

export async function saveSettingsAction(_s: MasterActionState, f: FormData): Promise<MasterActionState> {
  try {
    const viewer = await requireAccess('admin');
    const patch: SettingsPatch = {
      phoneNumberId: str(f, 'phoneNumberId', 40), wabaId: str(f, 'wabaId', 40), accessToken: str(f, 'accessToken', 1000), appSecret: str(f, 'appSecret', 200),
      firstAfterDays: num(f, 'firstAfterDays'), everyDays: num(f, 'everyDays'), maxMessages: num(f, 'maxMessages'), mode: str(f, 'mode', 10),
    };
    await saveWhatsAppSettings(await getDb(), patch, actorOf(viewer));
    done();
    return { success: 'Saved.' };
  } catch (e) { return fail(e); }
}

export async function submitTemplateAction(): Promise<MasterActionState> {
  try {
    const viewer = await requireAccess('admin');
    const status = await submitReminderTemplate(await getDb(), actorOf(viewer));
    done();
    return { success: `Sent to WhatsApp for approval (status: ${status}). Approval usually takes a day or less. Use “Check approval” to refresh.` };
  } catch (e) { return fail(e); }
}

export async function refreshTemplateAction(): Promise<MasterActionState> {
  try {
    await requireAccess('admin');
    const status = await refreshTemplateStatus(await getDb());
    done();
    return { success: status ? `WhatsApp says the template is: ${status}.` : 'WhatsApp does not list this template yet. Submit it first.' };
  } catch (e) { return fail(e); }
}

/** Records that a hostel asked (or no longer asks) to stop WhatsApp reminders. */
export async function optOutAction(_s: MasterActionState, f: FormData): Promise<MasterActionState> {
  try {
    const viewer = await requireAccess('edit');
    const godownId = Number(str(f, 'godownId', 12)); const hostelCode = str(f, 'hostelCode', 60) ?? '';
    const stop = str(f, 'stop', 3) === '1';
    if (!Number.isSafeInteger(godownId) || !hostelCode) throw new WhatsAppInputError('Bad request');
    const c = await getDb();
    const r = await c.hostelsMaster.updateOne({ godownId, hostelCode }, stop ? { $set: { whatsappOptOut: true, whatsappOptOutAt: new Date(), updatedAt: new Date() } } : { $set: { whatsappOptOut: false, updatedAt: new Date() } });
    if (!r.matchedCount) throw new WhatsAppInputError('Hostel not found.');
    await c.auditLog.insertOne({ actor: actorOf(viewer), action: stop ? 'whatsapp.opt-out' : 'whatsapp.opt-in', target: `hostel:${godownId}:${hostelCode}`, at: new Date() });
    revalidatePath('/hostel/[code]', 'page');
    return { success: stop ? 'Recorded. No more WhatsApp reminders will go to this hostel.' : 'Reminders to this hostel are switched back on.' };
  } catch (e) { return fail(e); }
}
