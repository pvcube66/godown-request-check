import { randomUUID } from 'node:crypto';
import type { Collection } from 'mongodb';
import type { AnomalyDoc, RequestDoc } from './db.js';
import type { OrderDoc } from './orders.js';
import { daysBetween } from './orders.js';
import type { AuditDoc } from './masterData.js';

/** The issue workflow. An "issue" is recorded INSIDE this app only. We never write to the government portal:
 *  the operator rejects the indent on the real portal themselves, and our hourly read notices it. */

export type IssueState = 'issue_raised' | 'rejected_on_portal' | 'resolved' | 'closed';
export const ACTIVE_STATES: IssueState[] = ['issue_raised', 'rejected_on_portal'];
export const STATE_TEXT: Record<IssueState, string> = {
  issue_raised: 'Raised. Not rejected on the portal yet',
  rejected_on_portal: 'Rejected on the portal. Waiting for a new indent',
  resolved: 'Resolved. A new indent came in',
  closed: 'Closed without a new indent',
};

export interface IssueEvent { state: IssueState; at: Date; by: string; note?: string }

export interface IssueDoc {
  issueId: string;
  source: 'flag' | 'manual';                    // 'flag' = raised from an unusual-request flag; 'manual' = an operator flagged an order
  godownId: number; hostelCode: string; hostelName: string; districtName: string;
  month: string;                                // yyyy-mm the goods were requested for
  anomalyKeys: string[];
  requestIds: string[];                         // every request this hostel had for that month when the issue was raised
  targetRequestIds: string[];                   // the ones the operator is expected to reject on the portal
  state: IssueState;
  reason: string;
  raisedBy: string; raisedByName: string; raisedAt: Date;
  rejectedAt: Date | null;                      // first time our hourly read saw a target rejected/cancelled on the portal
  newRequestId: string | null; newIndentAt: Date | null;
  closedAt: Date | null; closedBy: string | null; closeNote: string | null;
  history: IssueEvent[];
  updatedAt: Date;
}

export interface RemarkDoc {
  targetType: 'issue' | 'order';
  targetId: string;
  author: string; authorName: string;
  text: string;
  outcome: CallOutcome | null;
  at: Date;
}
export const CALL_OUTCOMES = ['reached', 'no_answer', 'will_fix', 'other'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export const OUTCOME_TEXT: Record<CallOutcome, string> = { reached: 'Spoke to them', no_answer: 'No answer', will_fix: 'They will fix it', other: 'Other' };

export interface IssueCollections {
  issues: Collection<IssueDoc>;
  remarks: Collection<RemarkDoc>;
  requests: Collection<RequestDoc>;
  orders: Collection<OrderDoc>;
  anomalies: Collection<AnomalyDoc>;
  settings: Collection<{ _id: string; value: unknown }>;
  auditLog: Collection<AuditDoc>;
}

export class IssueInputError extends Error {}

export const isRejectedStatus = (s: string) => /^(reject|cancel)/i.test(s.trim());

// ----- the wait setting -----
export const DEFAULT_WAIT_DAYS = 2;
export async function getWaitDays(c: Pick<IssueCollections, 'settings'>): Promise<number> {
  const v = (await c.settings.findOne({ _id: 'issueWaitDays' }))?.value;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 30 ? v : DEFAULT_WAIT_DAYS;
}
export async function setWaitDays(c: Pick<IssueCollections, 'settings' | 'auditLog'>, days: number, actor: string): Promise<void> {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new IssueInputError('Choose a whole number of days from 1 to 30.');
  const before = await getWaitDays(c);
  await c.settings.updateOne({ _id: 'issueWaitDays' }, { $set: { value: days } }, { upsert: true });
  await c.auditLog.insertOne({ actor, action: 'setting.issueWaitDays', target: 'issueWaitDays', at: new Date(), details: { before, after: days } });
}

// ----- pure rules -----
export type ReqView = Pick<RequestDoc, 'requestId' | 'status' | 'firstSeenAt'>;
export interface IssuePatch { state?: IssueState; rejectedAt?: Date; newRequestId?: string; newIndentAt?: Date }

/** What changed on the portal since the issue was last looked at. Returns null when nothing changed. */
export function evaluateIssue(
  issue: Pick<IssueDoc, 'state' | 'requestIds' | 'targetRequestIds' | 'raisedAt' | 'rejectedAt'>,
  reqs: readonly ReqView[], rejectedOrders: ReadonlySet<string>, now: Date,
): IssuePatch | null {
  if (!ACTIVE_STATES.includes(issue.state)) return null;
  const rejected = (id: string, status?: string) => rejectedOrders.has(id) || (status !== undefined && isRejectedStatus(status));
  const byId = new Map(reqs.map((r) => [r.requestId, r]));
  const patch: IssuePatch = {};
  if (issue.state === 'issue_raised' && issue.targetRequestIds.some((id) => rejected(id, byId.get(id)?.status))) {
    patch.state = 'rejected_on_portal'; patch.rejectedAt = now;
  }
  // A request we had never seen before the issue, for the same hostel and month, that is still alive = the new indent.
  const known = new Set(issue.requestIds);
  const fresh = reqs.filter((r) => !known.has(r.requestId) && !rejected(r.requestId, r.status) && r.firstSeenAt > issue.raisedAt)
    .sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime())[0];
  if (fresh) { patch.state = 'resolved'; patch.newRequestId = fresh.requestId; patch.newIndentAt = now; }
  return Object.keys(patch).length ? patch : null;
}

/** Whole days (India calendar) the hostel has been without a new indent since we saw the rejection. */
export function waitingDays(issue: Pick<IssueDoc, 'state' | 'rejectedAt'>, now = new Date()): number | null {
  return issue.state === 'rejected_on_portal' && issue.rejectedAt ? daysBetween(issue.rejectedAt, now) : null;
}
/** True once the wait has reached the allowed number of days. */
export const isOverdue = (issue: Pick<IssueDoc, 'state' | 'rejectedAt'>, waitDays: number, now = new Date()): boolean => {
  const d = waitingDays(issue, now);
  return d !== null && d >= waitDays;
};

// ----- actions -----
const audit = (c: Pick<IssueCollections, 'auditLog'>, actor: string, action: string, target: string, details?: unknown) =>
  c.auditLog.insertOne({ actor, action, target, at: new Date(), ...(details === undefined ? {} : { details }) });

const cleanText = (v: string, what: string, min: number, max: number) => {
  const t = v.replace(/\r\n/g, '\n').trim();
  if (t.length < min) throw new IssueInputError(min > 1 ? `Please write a little more (at least ${min} letters) in ${what}.` : `Please write something in ${what}.`);
  if (t.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(t)) throw new IssueInputError(`${what} must be ${max} characters or fewer.`);
  return t;
};
export const cleanReason = (v: string) => cleanText(v, 'what is wrong', 3, 1000);

export interface RaiseInput {
  reason: string; actor: string; actorName: string;
  /** From an unusual-request flag: the (already permission-checked) flags. Every flag must be for the same hostel and month. */
  anomalies?: Pick<AnomalyDoc, 'key' | 'godownId' | 'hostelCode' | 'hostelName' | 'districtName' | 'month'>[];
  /** Or an operator flags one order by hand (the order's request exists in `requests`). */
  manualRequest?: Pick<RequestDoc, 'requestId' | 'godownId' | 'hostelCode' | 'hostelName' | 'districtName' | 'month'>;
}

/** Records the issue (or adds to the one already open for this hostel and month). Never contacts the portal. */
export async function raiseIssue(c: IssueCollections, input: RaiseInput, now = new Date()): Promise<IssueDoc> {
  const reason = cleanReason(input.reason);
  const base = input.manualRequest ?? input.anomalies?.[0];
  if (!base) throw new IssueInputError('Nothing to raise an issue about.');
  const same = (x: { godownId: number; hostelCode: string; month: string }) => x.godownId === base.godownId && x.hostelCode === base.hostelCode && x.month === base.month;
  if (input.anomalies && !input.anomalies.every(same)) throw new IssueInputError('These flags are for different hostels or months. Raise them one at a time.');
  const keys = input.anomalies?.map((a) => a.key) ?? [];
  const scope = { godownId: base.godownId, hostelCode: base.hostelCode, month: base.month };

  const existing = await c.issues.findOne({ ...scope, state: { $in: ACTIVE_STATES } });
  if (existing) {
    await c.issues.updateOne({ issueId: existing.issueId }, { $addToSet: { anomalyKeys: { $each: keys } }, $set: { updatedAt: now } });
    await c.remarks.insertOne({ targetType: 'issue', targetId: existing.issueId, author: input.actor, authorName: input.actorName, text: reason, outcome: null, at: now });
    await audit(c, input.actor, 'issue.add', existing.issueId, { keys, reason });
    return { ...existing, anomalyKeys: [...new Set([...existing.anomalyKeys, ...keys])] };
  }

  const reqs = await c.requests.find(scope, { projection: { requestId: 1, status: 1 } }).toArray();
  const orderRej = await rejectedOrderIds(c, reqs.map((r) => r.requestId));
  const alive = reqs.filter((r) => !isRejectedStatus(r.status) && !orderRej.has(r.requestId)).map((r) => r.requestId);
  const manualId = input.manualRequest?.requestId;
  const targets = manualId ? (alive.includes(manualId) ? [manualId] : []) : alive;
  const state: IssueState = targets.length === 0 ? 'rejected_on_portal' : 'issue_raised';    // nothing left to reject: the wait starts now
  const issue: IssueDoc = {
    issueId: randomUUID(), source: input.manualRequest ? 'manual' : 'flag',
    godownId: base.godownId, hostelCode: base.hostelCode, hostelName: base.hostelName, districtName: base.districtName, month: base.month,
    anomalyKeys: keys, requestIds: reqs.map((r) => r.requestId), targetRequestIds: targets,
    state, reason, raisedBy: input.actor, raisedByName: input.actorName, raisedAt: now,
    rejectedAt: state === 'rejected_on_portal' ? now : null, newRequestId: null, newIndentAt: null, closedAt: null, closedBy: null, closeNote: null,
    history: [{ state, at: now, by: input.actor, note: reason }], updatedAt: now,
  };
  await c.issues.insertOne(issue);
  await c.remarks.insertOne({ targetType: 'issue', targetId: issue.issueId, author: input.actor, authorName: input.actorName, text: reason, outcome: null, at: now });
  await audit(c, input.actor, 'issue.raise', issue.issueId, { source: issue.source, keys, requestIds: targets });
  return issue;
}

async function rejectedOrderIds(c: Pick<IssueCollections, 'orders'>, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await c.orders.find({ requestId: { $in: ids }, stage: { $in: ['rejected', 'cancelled'] } }, { projection: { requestId: 1 } }).toArray();
  return new Set(rows.map((r) => r.requestId));
}

/** Hourly: read what the portal now says and move each open issue along. Reads our own copy of the portal data only. */
export async function syncIssues(c: IssueCollections, now = new Date()): Promise<{ checked: number; moved: number }> {
  const active = await c.issues.find({ state: { $in: ACTIVE_STATES } }).toArray();
  let moved = 0;
  for (const issue of active) {
    const reqs = await c.requests.find({ godownId: issue.godownId, hostelCode: issue.hostelCode, month: issue.month }, { projection: { requestId: 1, status: 1, firstSeenAt: 1 } }).toArray();
    const rejectedOrders = await rejectedOrderIds(c, reqs.map((r) => r.requestId));
    const patch = evaluateIssue(issue, reqs, rejectedOrders, now);
    if (!patch) continue;
    const events: IssueEvent[] = [];
    if (patch.rejectedAt) events.push({ state: 'rejected_on_portal', at: now, by: 'system', note: 'Rejected on the portal (seen in the hourly check)' });
    if (patch.newRequestId) events.push({ state: 'resolved', at: now, by: 'system', note: `New indent ${patch.newRequestId} received` });
    const res = await c.issues.updateOne(
      { issueId: issue.issueId, state: { $in: ACTIVE_STATES } },
      { $set: { ...patch, updatedAt: now }, $push: { history: { $each: events } } },
    );
    if (res.matchedCount) moved++;
  }
  return { checked: active.length, moved };
}

/** Someone ends an issue by hand, with a note. Allowed from any open state. */
export async function closeIssue(c: IssueCollections, issueId: string, note: string, actor: string, now = new Date()): Promise<void> {
  const text = cleanText(note, 'the note', 3, 1000);
  const res = await c.issues.updateOne(
    { issueId, state: { $in: ACTIVE_STATES } },
    { $set: { state: 'closed', closedAt: now, closedBy: actor, closeNote: text, updatedAt: now }, $push: { history: { state: 'closed', at: now, by: actor, note: text } } },
  );
  if (res.matchedCount !== 1) throw new IssueInputError('This issue is not open any more.');
  await audit(c, actor, 'issue.close', issueId, { note: text });
}

// ----- remarks -----
export async function addRemark(c: Pick<IssueCollections, 'remarks' | 'auditLog'>, r: { targetType: RemarkDoc['targetType']; targetId: string; text: string; outcome?: string; actor: string; actorName: string }, now = new Date()): Promise<void> {
  const text = cleanText(r.text, 'the remark', 1, 1000);
  const outcome = r.outcome ? ((CALL_OUTCOMES as readonly string[]).includes(r.outcome) ? (r.outcome as CallOutcome) : null) : null;
  if (r.outcome && !outcome) throw new IssueInputError('Choose one of the call results from the list.');
  await c.remarks.insertOne({ targetType: r.targetType, targetId: r.targetId, author: r.actor, authorName: r.actorName, text, outcome, at: now });
  await audit(c, r.actor, 'remark.add', `${r.targetType}:${r.targetId}`);
}
