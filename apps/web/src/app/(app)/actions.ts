'use server';
import { revalidatePath } from 'next/cache';
import { addAccount, runCycle } from '@anomaly/core';
import { getDb } from '@/lib/db';

const STATUSES = ['open', 'confirmed', 'ignored', 'expected'] as const;

export async function setAnomalyStatuses(keys: string[], status: string): Promise<void> {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 100 || keys.some((k) => typeof k !== 'string')) throw new Error('Bad request');
  if (!(STATUSES as readonly string[]).includes(status)) throw new Error('Bad status');
  const c = await getDb();
  await c.anomalies.updateMany({ key: { $in: keys } }, { $set: { status: status as (typeof STATUSES)[number], updatedAt: new Date() } });
  revalidatePath('/'); revalidatePath('/report');
}

export async function addAccountAction(_prev: unknown, formData: FormData): Promise<{ ok: boolean; message: string }> {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!username || !password) return { ok: false, message: 'Enter both username and password.' };
  try {
    const c = await getDb();
    const r = await addAccount(c, username, password);
    // first pull in the background-safe way: fetch all months so history exists straight away
    await runCycle(c, 'new-account', 'backfill');
    revalidatePath('/accounts'); revalidatePath('/');
    return { ok: true, message: `Added ${r.username} (godowns: ${r.godowns.map((g) => g.name).join(', ')}). History loaded.` };
  } catch (e) {
    return { ok: false, message: `We could not add this login: ${e instanceof Error ? e.message : String(e)}` };
  }
}
