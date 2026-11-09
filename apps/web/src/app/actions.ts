'use server';
import { revalidatePath } from 'next/cache';
import { addAccount, runCycle } from '@anomaly/core';
import { getDb } from '@/lib/db';

const STATUSES = ['open', 'confirmed', 'ignored', 'expected'] as const;

export async function setAnomalyStatus(formData: FormData) {
  const key = String(formData.get('key') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!key || !(STATUSES as readonly string[]).includes(status)) return;
  const c = await getDb();
  await c.anomalies.updateOne({ key }, { $set: { status: status as (typeof STATUSES)[number], updatedAt: new Date() } });
  revalidatePath('/');
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
    return { ok: false, message: `Could not add login: ${e instanceof Error ? e.message : String(e)}` };
  }
}
