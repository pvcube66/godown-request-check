import { isOverdue, scoped, STAGE_LABEL, type Collections, type IssueDoc } from '@anomaly/core';

export const ISSUE_TABS = [
  { key: 'waiting', label: 'Waiting for a new indent', states: ['rejected_on_portal'] },
  { key: 'raised', label: 'Not rejected on the portal yet', states: ['issue_raised'] },
  { key: 'done', label: 'Finished', states: ['resolved', 'closed'] },
  { key: 'all', label: 'All', states: ['issue_raised', 'rejected_on_portal', 'resolved', 'closed'] },
] as const;
export type IssueTab = (typeof ISSUE_TABS)[number]['key'];

export async function loadIssues(c: Collections, tab: IssueTab, names: string[] | null): Promise<IssueDoc[]> {
  const t = ISSUE_TABS.find((x) => x.key === tab) ?? ISSUE_TABS[0];
  // the longest-waiting are first: oldest rejection (or raise date) at the top for open ones, newest first when finished
  const sort = (t.key === 'done' ? { updatedAt: -1 } : { rejectedAt: 1, raisedAt: 1 }) as never;
  return c.issues.find(scoped({ state: { $in: [...t.states] } }, names)).sort(sort).limit(500).toArray();
}

export async function issueCounts(c: Collections, names: string[] | null): Promise<Record<string, number>> {
  const rows = await c.issues.aggregate<{ _id: string; n: number }>([{ $match: scoped({}, names) }, { $group: { _id: '$state', n: { $sum: 1 } } }]).toArray();
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  return { waiting: by.rejected_on_portal ?? 0, raised: by.issue_raised ?? 0, done: (by.resolved ?? 0) + (by.closed ?? 0), all: rows.reduce((s, r) => s + r.n, 0) };
}

/** Open issues whose wait has gone past the allowed days (for the alert on the first page). */
export async function overdueCount(c: Collections, names: string[] | null, waitDays: number, now = new Date()): Promise<number> {
  const open = await c.issues.find(scoped({ state: 'rejected_on_portal' }, names), { projection: { rejectedAt: 1, state: 1 } }).toArray();
  return open.filter((i) => isOverdue(i, waitDays, now)).length;
}

export interface IssueIndent { status: string; placedOn: Date | null }

/** The current portal status (and indent date) of the indent(s) each issue is about, in one query. A resolved issue shows its new indent. */
export async function loadIssueIndents(c: Collections, issues: IssueDoc[]): Promise<Map<string, IssueIndent>> {
  const idsOf = (i: IssueDoc) => (i.state === 'resolved' && i.newRequestId ? [i.newRequestId] : i.targetRequestIds.length ? i.targetRequestIds : i.requestIds);
  const all = [...new Set(issues.flatMap(idsOf))];
  const out = new Map<string, IssueIndent>();
  if (!all.length) return out;
  const rows = await c.orders.find({ requestId: { $in: all } }, { projection: { requestId: 1, stage: 1, placedOn: 1 } }).toArray();
  const by = new Map(rows.map((r) => [r.requestId, r]));
  for (const i of issues) {
    const found = idsOf(i).map((id) => by.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
    if (!found.length) { out.set(i.issueId, { status: '—', placedOn: null }); continue; }
    const counts = new Map<string, number>();
    for (const r of found) counts.set(STAGE_LABEL[r.stage], (counts.get(STAGE_LABEL[r.stage]) ?? 0) + 1);
    const status = [...counts].map(([label, n]) => (found.length > 1 ? `${label} (${n})` : label)).join(', ');
    const dates = found.map((r) => r.placedOn).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
    out.set(i.issueId, { status, placedOn: dates[0] ?? null });
  }
  return out;
}
