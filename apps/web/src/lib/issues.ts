import { isOverdue, scoped, type Collections, type IssueDoc } from '@anomaly/core';

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
