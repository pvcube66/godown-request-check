'use server';

import { revalidatePath } from 'next/cache';
import { changeCampaign, createCampaign, retryFailed, reviewCampaign, runCampaignBatch, WhatsAppInputError, type BatchResult, type CampaignInput } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { actorOf, requireAccess } from '@/lib/viewer';

export type Res<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const fail = (e: unknown): { ok: false; message: string } => ({ ok: false, message: e instanceof WhatsAppInputError ? e.message : 'Something went wrong. Please sign in again if the page was left open, then try again.' });
const list = (v: unknown, max: number, len: number): string[] => { if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== 'string' || x.length > len)) throw new WhatsAppInputError('That request is not valid. Refresh the page and try again.'); return v as string[]; };
const idOk = (v: unknown): string => { if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/.test(v)) throw new WhatsAppInputError('That campaign was not found.'); return v; };

function clean(i: CampaignInput): CampaignInput {
  if (!i || typeof i.name !== 'string' || i.name.length > 200 || typeof i.template?.name !== 'string' || typeof i.template?.language !== 'string') throw new WhatsAppInputError('That request is not valid. Refresh the page and try again.');
  return { name: i.name, template: { name: i.template.name, language: i.template.language }, body: list(i.body, 20, 1000), header: list(i.header, 2, 1000), audience: { all: i.audience?.all === true, tags: list(i.audience?.tags ?? [], 50, 50), groups: list(i.audience?.groups ?? [], 50, 100) } };
}

export async function reviewCampaignAction(i: CampaignInput): Promise<Res<{ people: number; optedOut: number; will: number; sample: string }>> {
  try { await requireAccess('admin'); return { ok: true, ...(await reviewCampaign(await getDb(), clean(i))) }; } catch (e) { return fail(e); }
}
export async function createCampaignAction(i: CampaignInput): Promise<Res<{ id: string }>> {
  try { const v = await requireAccess('admin'); const d = await createCampaign(await getDb(), clean(i), actorOf(v)); revalidatePath('/whatsapp/campaigns'); return { ok: true, id: d.campaignId }; } catch (e) { return fail(e); }
}
export async function changeCampaignAction(id: string, action: string): Promise<Res<{ message: string }>> {
  try {
    const v = await requireAccess('admin');
    if (!['start', 'pause', 'resume', 'cancel'].includes(action)) throw new WhatsAppInputError('That request is not valid.');
    await changeCampaign(await getDb(), idOk(id), action as 'start', actorOf(v));
    revalidatePath('/whatsapp/campaigns'); revalidatePath(`/whatsapp/campaigns/${id}`);
    return { ok: true, message: { start: 'Campaign started.', pause: 'Campaign paused.', resume: 'Campaign resumed.', cancel: 'Campaign cancelled.' }[action]! };
  } catch (e) { return fail(e); }
}
export async function retryFailedAction(id: string): Promise<Res<{ message: string }>> {
  try { const v = await requireAccess('admin'); const n = await retryFailed(await getDb(), idOk(id), actorOf(v)); revalidatePath(`/whatsapp/campaigns/${id}`); return { ok: true, message: n ? `${n} failed message${n === 1 ? '' : 's'} will be tried again.` : 'There is nothing to retry.' }; } catch (e) { return fail(e); }
}
/** Sends the next small batch. The page calls this every few seconds while a campaign is running. */
export async function tickCampaignAction(id: string): Promise<Res<{ result: BatchResult }>> {
  try { await requireAccess('admin'); return { ok: true, result: await runCampaignBatch(await getDb(), idOk(id)) }; } catch (e) { return fail(e); }
}
