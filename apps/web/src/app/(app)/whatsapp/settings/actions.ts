'use server';

import { revalidatePath } from 'next/cache';
import { addQuickReply, deleteQuickReply, ensureWhatsAppSettings, saveBusinessProfile, WhatsAppApiError, WhatsAppInputError, getMetaFailureCopy, type BusinessProfile } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { actorOf, requireAccess } from '@/lib/viewer';

export interface Result { ok: boolean; message: string }
const fail = (e: unknown): Result => e instanceof WhatsAppInputError ? { ok: false, message: e.message } : e instanceof WhatsAppApiError ? { ok: false, message: `${getMetaFailureCopy(e.message).title}. ${getMetaFailureCopy(e.message).action}` } : { ok: false, message: 'Something went wrong. Please sign in again if the page was left open, then try again.' };
const text = (v: unknown, max: number) => { if (typeof v !== 'string' || v.length > max) throw new WhatsAppInputError('That value is not valid.'); return v; };

export async function saveProfileAction(p: BusinessProfile): Promise<Result> {
  try {
    const viewer = await requireAccess('admin'); const c = await getDb();
    const websites = Array.isArray(p?.websites) && p.websites.length <= 5 ? p.websites.map((w) => text(w, 300)) : (() => { throw new WhatsAppInputError('That value is not valid.'); })();
    await saveBusinessProfile(c, await ensureWhatsAppSettings(c), { about: text(p.about, 400), description: text(p.description, 1000), address: text(p.address, 600), email: text(p.email, 200), websites, vertical: text(p.vertical, 30), pictureUrl: '' }, actorOf(viewer));
    revalidatePath('/whatsapp/settings/profile');
    return { ok: true, message: 'Saved to WhatsApp.' };
  } catch (e) { return fail(e); }
}
export async function addQuickReplyAction(title: string, body: string): Promise<Result> {
  try { const v = await requireAccess('admin'); await addQuickReply(await getDb(), text(title, 100), text(body, 3000), actorOf(v)); revalidatePath('/whatsapp/settings/quick-replies'); revalidatePath('/whatsapp/chats'); return { ok: true, message: 'Quick reply saved.' }; } catch (e) { return fail(e); }
}
export async function deleteQuickReplyAction(title: string): Promise<Result> {
  try { const v = await requireAccess('admin'); await deleteQuickReply(await getDb(), text(title, 100), actorOf(v)); revalidatePath('/whatsapp/settings/quick-replies'); revalidatePath('/whatsapp/chats'); return { ok: true, message: 'Deleted.' }; } catch (e) { return fail(e); }
}
