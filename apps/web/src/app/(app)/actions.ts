
'use server';
import { revalidatePath } from 'next/cache';
import { addAccount, runCycle, scoped } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { requireMasterAdmin } from '@/lib/master-auth';
import { actorOf, requireAccess, requireViewer, visibleDistricts } from '@/lib/viewer';

const STATUSES = ['open', 'confirmed', 'ignored', 'expected'] as const;

export async function setAnomalyStatuses(keys: string[], status: string): Promise<void> {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 100 || keys.some((k) => typeof k !== 'string')) throw new Error('Bad request');
  if (!(STATUSES as readonly string[]).includes(status)) throw new Error('Bad status');
  const viewer = await requireAccess('edit');                          // viewers are read-only
  const c = await getDb();
  // only flags in the person's own districts can be changed, even if a key from elsewhere is sent
  const r = await c.anomalies.updateMany(scoped({ key: { $in: keys } }, await visibleDistricts(c, viewer)), { $set: { status: status as (typeof STATUSES)[number], updatedAt: new Date() } });
  await c.auditLog.insertOne({ actor: actorOf(viewer), action: `flag.${status}`, target: `${keys.length} flag(s)`, at: new Date(), details: { keys, changed: r.modifiedCount } });
  revalidatePath('/'); revalidatePath('/report');
}

export async function addAccountAction(_prev: unknown, formData: FormData): Promise<{ ok: boolean; message: string }> {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!username || !password) return { ok: false, message: 'Enter both username and password.' };
  try {
    const { actor } = await requireMasterAdmin();
    const c = await getDb();
    const r = await addAccount(c, username, password);
    await c.auditLog.insertOne({ actor, action: 'godown.add', target: r.username, at: new Date(), details: { godowns: r.godowns } });
    // first pull in the background-safe way: fetch all months so history exists straight away
    await runCycle(c, 'new-account', 'backfill');
    revalidatePath('/accounts'); revalidatePath('/master'); revalidatePath('/');
    return { ok: true, message: `Added ${r.username} (godowns: ${r.godowns.map((g) => g.name).join(', ')}). History loaded. Open Master data to assign its districts.` };
  } catch (e) {
    return { ok: false, message: `We could not add this login: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** "Force refresh": any signed-in person can ask for a fresh pull from the portal right now. Only one check runs at a time. */
export async function forceRefreshAction(): Promise<{ ok: boolean; message: string }> {
  try {
    const viewer = await requireViewer();
    const c = await getDb();
    const run = await runCycle(c, 'manual', 'recent', { budgetMs: 120_000 });
    if (!run) return { ok: false, message: 'A check is already running. Please try again in a few minutes.' };
    await c.auditLog.insertOne({ actor: actorOf(viewer), action: 'refresh.force', target: 'portal', at: new Date(), details: { ok: run.ok } });
    revalidatePath('/', 'layout');
    return run.ok ? { ok: true, message: 'Data refreshed from the portal.' } : { ok: false, message: 'Refreshed, but some godowns could not be read. See Past checks.' };
  } catch {
    return { ok: false, message: 'Could not refresh. Please sign in again and retry.' };
  }
}
