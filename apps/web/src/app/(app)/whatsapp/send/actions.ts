'use server';

import { revalidatePath } from 'next/cache';
import { sendMessages, WhatsAppInputError, type SendSummary } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { actorOf, requireAccess } from '@/lib/viewer';

export interface SendInput { kind: 'template' | 'text'; template?: { name: string; language: string }; body?: string[]; header?: string[]; text?: string; phones: string[]; groups: string[]; batchId: string }
export type SendActionResult = { ok: true; summary: SendSummary } | { ok: false; message: string };

const strs = (v: unknown, max: number, len: number): string[] => {
  if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== 'string' || x.length > len)) throw new WhatsAppInputError('That request is not valid. Refresh the page and try again.');
  return v as string[];
};

/** preview = work out and show what would happen, send nothing. Otherwise sends (only when WhatsApp is live). Administrators only. */
export async function sendAction(input: SendInput, preview: boolean): Promise<SendActionResult> {
  try {
    const viewer = await requireAccess('admin');
    if (input?.kind !== 'template' && input?.kind !== 'text') throw new WhatsAppInputError('Choose what to send.');
    const t = input.template;
    if (input.kind === 'template' && (!t || typeof t.name !== 'string' || typeof t.language !== 'string')) throw new WhatsAppInputError('Choose a template.');
    if (typeof input.batchId !== 'string' || input.batchId.length > 80) throw new WhatsAppInputError('Refresh the page and try again.');
    const summary = await sendMessages(await getDb(), {
      kind: input.kind, ...(input.kind === 'template' ? { template: { name: String(t!.name), language: String(t!.language) }, body: strs(input.body ?? [], 20, 1000), header: strs(input.header ?? [], 2, 1000) } : { text: typeof input.text === 'string' ? input.text : '' }),
      phones: strs(input.phones, 500, 20), groups: strs(input.groups, 50, 100), batchId: input.batchId,
    }, { preview: preview !== false, actor: actorOf(viewer) });
    if (!summary.preview) revalidatePath('/whatsapp/send');
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, message: e instanceof WhatsAppInputError ? e.message : 'Something went wrong. Please sign in again if the page was left open, then try again.' };
  }
}
