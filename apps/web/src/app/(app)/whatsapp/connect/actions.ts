'use server';

import { revalidatePath } from 'next/cache';
import { connectManual, connectWithCode, connectionStatus, disconnect, ensureWhatsAppSettings, fixWebhook, getMetaFailureCopy, saveMetaApp, WhatsAppApiError, WhatsAppInputError } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { actorOf, requireAccess } from '@/lib/viewer';

export interface StatusData {
  connected: boolean;
  variables: { wabaId: string; phoneNumberId: string; displayPhone: string; verifiedName: string; connectedAt: string | null } | null;
  checks: { tokenValid: boolean; webhookSubscribed: boolean; templateApproved: boolean };
}
export interface Result<T = undefined> { ok: boolean; message: string; data?: T }

const fail = (e: unknown): Result<never> => {
  if (e instanceof WhatsAppInputError) return { ok: false, message: e.message };
  if (e instanceof WhatsAppApiError) { const c = getMetaFailureCopy(e.message); return { ok: false, message: `WhatsApp said: ${c.title}. ${c.action}${c.code ? ` (code ${c.code})` : ''} ${e.message.includes(':') ? `Details: ${e.message.split(':').slice(1).join(':').trim().slice(0, 200)}` : ''}`.trim() }; }
  return { ok: false, message: 'Something went wrong. Please sign in again if the page was left open, then try again.' };
};
const text = (v: unknown, max: number) => { if (typeof v !== 'string' || v.length > max) throw new WhatsAppInputError('That value is not valid.'); return v; };
const refresh = () => { revalidatePath('/whatsapp'); revalidatePath('/whatsapp/connect'); revalidatePath('/', 'layout'); };

/** The Meta app the connection goes through. */
export async function saveMetaAppAction(appId: string, appSecret: string, configId: string): Promise<Result> {
  try {
    const viewer = await requireAccess('admin');
    await saveMetaApp(await getDb(), { appId: text(appId, 30), appSecret: text(appSecret, 200), configId: text(configId, 30) }, actorOf(viewer));
    refresh();
    return { ok: true, message: 'Saved.' };
  } catch (e) { return fail(e); }
}

export async function connectCodeAction(code: string): Promise<Result<{ displayPhone: string }>> {
  try {
    const viewer = await requireAccess('admin');
    const c = await getDb();
    const r = await connectWithCode(c, await ensureWhatsAppSettings(c), text(code, 2000), actorOf(viewer));
    refresh();
    return { ok: true, message: `Connected ${r.displayPhone}.`, data: { displayPhone: r.displayPhone } };
  } catch (e) { return fail(e); }
}

export async function connectManualAction(token: string, phoneNumberId: string): Promise<Result<{ displayPhone: string }>> {
  try {
    const viewer = await requireAccess('admin');
    const c = await getDb();
    const r = await connectManual(c, await ensureWhatsAppSettings(c), text(token, 1000), text(phoneNumberId, 30), actorOf(viewer));
    refresh();
    return { ok: true, message: `Connected ${r.displayPhone}.`, data: { displayPhone: r.displayPhone } };
  } catch (e) { return fail(e); }
}

export async function statusAction(): Promise<Result<StatusData>> {
  try {
    await requireAccess('admin');
    const s = await connectionStatus(await ensureWhatsAppSettings(await getDb()));
    return { ok: true, message: '', data: { connected: s.connected, checks: s.checks, variables: s.variables ? { ...s.variables, connectedAt: s.variables.connectedAt ? s.variables.connectedAt.toISOString() : null } : null } };
  } catch (e) { return fail(e); }
}

export async function fixWebhookAction(): Promise<Result> {
  try {
    const viewer = await requireAccess('admin');
    const c = await getDb();
    const ok = await fixWebhook(c, await ensureWhatsAppSettings(c), actorOf(viewer));
    refresh();
    return ok ? { ok: true, message: 'Webhooks subscribed.' } : { ok: false, message: 'Meta did not confirm the subscription.' };
  } catch (e) { return fail(e); }
}

export async function disconnectAction(): Promise<Result> {
  try {
    const viewer = await requireAccess('admin');
    await disconnect(await getDb(), actorOf(viewer));
    refresh();
    return { ok: true, message: 'Disconnected. Reminders are back to preview only.' };
  } catch (e) { return fail(e); }
}
