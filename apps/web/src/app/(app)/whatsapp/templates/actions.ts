'use server';

import { revalidatePath } from 'next/cache';
import { ensureWhatsAppSettings, getMetaFailureCopy, removeTemplate, saveDraft, submitTemplate, syncTemplates, validateTemplate, WhatsAppApiError, WhatsAppInputError, type TemplateForm } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { actorOf, requireAccess } from '@/lib/viewer';

export interface Result { ok: boolean; message: string; errors?: string[] }
const fail = (e: unknown): Result => {
  if (e instanceof WhatsAppInputError) return { ok: false, message: e.message };
  if (e instanceof WhatsAppApiError) { const c = getMetaFailureCopy(e.message); const detail = e.message.includes(':') ? e.message.split(':').slice(1).join(':').trim().slice(0, 240) : ''; return { ok: false, message: `WhatsApp said: ${detail || c.title}${c.code ? ` (code ${c.code})` : ''}` }; }
  return { ok: false, message: 'Something went wrong. Please sign in again if the page was left open, then try again.' };
};
const refresh = () => { revalidatePath('/whatsapp/templates'); };

/** Only plain text fields, with limits, so nothing odd reaches Meta or the database. */
function cleanForm(f: TemplateForm): TemplateForm {
  const t = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  if (!f || typeof f !== 'object') throw new WhatsAppInputError('Bad request');
  return {
    name: t(f.name, 512).trim(), language: t(f.language, 10), category: f.category === 'MARKETING' ? 'MARKETING' : 'UTILITY',
    headerText: t(f.headerText, 200), body: t(f.body, 1200), examples: Array.isArray(f.examples) ? f.examples.slice(0, 20).map((e) => t(e, 200)) : [],
    headerExample: t(f.headerExample, 200), footer: t(f.footer, 200),
    buttons: Array.isArray(f.buttons) ? f.buttons.slice(0, 10).map((b) => ({ type: b.type === 'URL' || b.type === 'PHONE_NUMBER' ? b.type : 'QUICK_REPLY', text: t(b.text, 60), ...(b.type === 'URL' ? { url: t(b.url, 2000) } : {}), ...(b.type === 'PHONE_NUMBER' ? { phone_number: t(b.phone_number, 20) } : {}) })) : [],
  };
}

export async function syncTemplatesAction(): Promise<Result> {
  try {
    await requireAccess('admin');
    const c = await getDb();
    const r = await syncTemplates(c, await ensureWhatsAppSettings(c));
    refresh();
    return { ok: true, message: `${r.total} template${r.total === 1 ? '' : 's'} on WhatsApp.${r.removed ? ` ${r.removed} no longer exist${r.removed === 1 ? 's' : ''} there and were removed here.` : ''}` };
  } catch (e) { return fail(e); }
}

export async function saveDraftAction(form: TemplateForm): Promise<Result> {
  try {
    const viewer = await requireAccess('admin');
    await saveDraft(await getDb(), cleanForm(form), actorOf(viewer));
    refresh();
    return { ok: true, message: 'Draft saved. It has not been sent to WhatsApp.' };
  } catch (e) { return fail(e); }
}

export async function submitTemplateFormAction(form: TemplateForm): Promise<Result> {
  try {
    const viewer = await requireAccess('admin');
    const clean = cleanForm(form);
    const errors = validateTemplate(clean);
    if (errors.length) return { ok: false, message: errors[0]!, errors };
    const c = await getDb();
    const r = await submitTemplate(c, await ensureWhatsAppSettings(c), clean, actorOf(viewer));
    refresh();
    return { ok: true, message: `Sent to WhatsApp for approval (status: ${r.status}). It usually takes a day or less.` };
  } catch (e) { return fail(e); }
}

export async function deleteTemplateAction(name: string, language: string): Promise<Result> {
  try {
    const viewer = await requireAccess('admin');
    if (typeof name !== 'string' || typeof language !== 'string' || name.length > 512 || language.length > 10) throw new WhatsAppInputError('Bad request');
    const c = await getDb();
    await removeTemplate(c, await ensureWhatsAppSettings(c), name, language, actorOf(viewer));
    refresh();
    return { ok: true, message: 'Deleted.' };
  } catch (e) { return fail(e); }
}
