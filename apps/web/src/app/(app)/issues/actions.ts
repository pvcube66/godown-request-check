'use server';

import { revalidatePath } from 'next/cache';
import { addRemark, closeIssue, IssueInputError, raiseIssue, scoped, setWaitDays } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { actorOf, requireAccess, visibleDistricts } from '@/lib/viewer';
import type { MasterActionState } from '../master/action-state';

const str = (f: FormData, k: string, max = 1000) => {
  const v = f.get(k);
  if (typeof v !== 'string' || v.length > max) throw new IssueInputError(`Invalid ${k}`);
  return v;
};
function fail(e: unknown): { error: string } {
  if (e instanceof IssueInputError) return { error: e.message };
  return { error: 'Could not save this. Please sign in again if the page was left open, then try again. Nothing was changed on the portal.' };
}
const refresh = () => { for (const p of ['/', '/issues', '/orders', '/indents', '/dashboards']) revalidatePath(p); revalidatePath('/issues/[issueId]', 'page'); revalidatePath('/hostel/[code]', 'page'); revalidatePath('/orders/[requestId]', 'page'); };

/** From the flag cards: "Issue (reject this indent)". Records it here only; the operator rejects on the portal themselves. */
export async function raiseIssueAction(keys: string[], reason: string): Promise<{ ok: boolean; message: string; issueId?: string }> {
  try {
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > 100 || keys.some((k) => typeof k !== 'string') || typeof reason !== 'string') throw new IssueInputError('Bad request');
    const viewer = await requireAccess('edit');
    const c = await getDb();
    const unique = [...new Set(keys)];
    const flags = await c.anomalies.find(scoped({ key: { $in: unique } }, await visibleDistricts(c, viewer))).toArray();
    if (flags.length !== unique.length) throw new IssueInputError('One of these flags is no longer available. Refresh the page.');
    const groups = new Map<string, typeof flags>();
    for (const f of flags) { const k = `${f.godownId}|${f.hostelCode}|${f.month}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(f); }
    let first: string | undefined;
    for (const g of groups.values()) {
      const issue = await raiseIssue(c, { anomalies: g, reason, actor: actorOf(viewer), actorName: viewer.name });
      first ??= issue.issueId;
    }
    await c.anomalies.updateMany({ key: { $in: unique } }, { $set: { status: 'confirmed', updatedAt: new Date() } });
    refresh();
    return { ok: true, message: 'Issue recorded. Now reject this indent on the government portal. We will see it there within the hour.', ...(first ? { issueId: first } : {}) };
  } catch (e) { return { ok: false, message: fail(e).error }; }
}

/** An operator flags any order by hand. */
export async function flagOrderAction(_s: MasterActionState, f: FormData): Promise<MasterActionState> {
  try {
    const viewer = await requireAccess('edit');
    const c = await getDb();
    const names = await visibleDistricts(c, viewer);
    const requestId = str(f, 'requestId', 100);
    const order = await c.orders.findOne(scoped({ requestId }, names));
    const request = await c.requests.findOne(scoped({ requestId }, names));
    if (!order || !request) throw new IssueInputError('We could not find this order in your districts.');
    await raiseIssue(c, { reason: str(f, 'reason'), manualRequest: request, actor: actorOf(viewer), actorName: viewer.name });
    refresh();
    return { success: 'Order flagged and added to Issues. Reject it on the government portal if it must be redone.' };
  } catch (e) { return fail(e); }
}

export async function addRemarkAction(_s: MasterActionState, f: FormData): Promise<MasterActionState> {
  try {
    const viewer = await requireAccess('edit');
    const c = await getDb();
    const names = await visibleDistricts(c, viewer);
    const targetType = str(f, 'targetType', 10);
    const targetId = str(f, 'targetId', 100);
    if (targetType === 'issue') { if (!await c.issues.findOne(scoped({ issueId: targetId }, names))) throw new IssueInputError('This issue is not in your districts.'); }
    else if (targetType === 'order') { if (!await c.orders.findOne(scoped({ requestId: targetId }, names))) throw new IssueInputError('This order is not in your districts.'); }
    else throw new IssueInputError('Bad request');
    await addRemark(c, { targetType, targetId, text: str(f, 'text'), outcome: str(f, 'outcome', 20), actor: actorOf(viewer), actorName: viewer.name });
    refresh();
    return { success: 'Remark added.' };
  } catch (e) { return fail(e); }
}

export async function closeIssueAction(_s: MasterActionState, f: FormData): Promise<MasterActionState> {
  try {
    const viewer = await requireAccess('edit');
    const c = await getDb();
    const issueId = str(f, 'issueId', 100);
    if (!await c.issues.findOne(scoped({ issueId }, await visibleDistricts(c, viewer)))) throw new IssueInputError('This issue is not in your districts.');
    await closeIssue(c, issueId, str(f, 'note'), actorOf(viewer));
    refresh();
    return { success: 'Issue closed.' };
  } catch (e) { return fail(e); }
}

export async function waitDaysAction(_s: MasterActionState, f: FormData): Promise<MasterActionState> {
  try {
    const viewer = await requireAccess('admin');
    await setWaitDays(await getDb(), Number(str(f, 'days', 3)), actorOf(viewer));
    refresh();
    return { success: 'Saved. The new number applies to every godown straight away.' };
  } catch (e) { return fail(e); }
}
