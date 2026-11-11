'use server';

import { revalidatePath } from 'next/cache';
import { markRead, setConversationStatus } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { requireAccess } from '@/lib/viewer';

const ok = (p: unknown): p is string => typeof p === 'string' && /^\d{8,15}$/.test(p);

export async function markReadAction(phone: string): Promise<void> {
  try { await requireAccess('admin'); if (ok(phone)) await markRead(await getDb(), phone); revalidatePath('/whatsapp/chats'); } catch { /* the page still works */ }
}
export async function setChatStatusAction(phone: string, status: string): Promise<{ ok: boolean; message: string }> {
  try {
    await requireAccess('admin');
    if (!ok(phone) || (status !== 'open' && status !== 'closed')) return { ok: false, message: 'That request is not valid.' };
    const done = await setConversationStatus(await getDb(), phone, status);
    revalidatePath('/whatsapp/chats');
    return done ? { ok: true, message: status === 'closed' ? 'Chat closed.' : 'Chat reopened.' } : { ok: false, message: 'That chat no longer exists.' };
  } catch { return { ok: false, message: 'Something went wrong. Please sign in again if the page was left open, then try again.' }; }
}
