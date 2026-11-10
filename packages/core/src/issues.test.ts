import { describe, expect, it } from 'vitest';
import { cleanReason, evaluateIssue, getWaitDays, isOverdue, isRejectedStatus, IssueInputError, setWaitDays, waitingDays, type IssueCollections, type IssueDoc } from './issues.js';

const T0 = new Date('2026-11-03T06:00:00Z');
const base: Pick<IssueDoc, 'state' | 'requestIds' | 'targetRequestIds' | 'raisedAt' | 'rejectedAt'> = {
  state: 'issue_raised', requestIds: ['R1', 'R2'], targetRequestIds: ['R1'], raisedAt: T0, rejectedAt: null,
};
const req = (requestId: string, status: string, firstSeenAt = new Date('2026-11-01T00:00:00Z')) => ({ requestId, status, firstSeenAt });
const now = new Date('2026-11-05T06:00:00Z');

describe('rejected status', () => {
  it.each(['Rejected', 'rejected', 'Reject', 'Cancelled', 'canceled', ' Cancelled '])('treats %j as rejected', (s) => expect(isRejectedStatus(s)).toBe(true));
  it.each(['Pending', 'DC_Generated', 'Acknowledged', 'In_Trasit', ''])('does not treat %j as rejected', (s) => expect(isRejectedStatus(s)).toBe(false));
});

describe('moving an issue along', () => {
  it('does nothing while nothing changed on the portal', () => {
    expect(evaluateIssue(base, [req('R1', 'Pending'), req('R2', 'Pending')], new Set(), now)).toBeNull();
  });
  it('starts the wait when the operator has rejected the indent on the portal', () => {
    expect(evaluateIssue(base, [req('R1', 'Rejected'), req('R2', 'Pending')], new Set(), now)).toEqual({ state: 'rejected_on_portal', rejectedAt: now });
  });
  it('also notices a rejection that only the orders feed shows', () => {
    expect(evaluateIssue(base, [req('R1', 'Pending')], new Set(['R1']), now)).toEqual({ state: 'rejected_on_portal', rejectedAt: now });
  });
  it('ignores a rejection of a request that is not the target', () => {
    expect(evaluateIssue(base, [req('R1', 'Pending'), req('R2', 'Rejected')], new Set(), now)).toBeNull();
  });
  it('resolves when a brand-new live request appears for the same hostel and month', () => {
    const waiting = { ...base, state: 'rejected_on_portal' as const, rejectedAt: T0 };
    expect(evaluateIssue(waiting, [req('R1', 'Rejected'), req('R2', 'Pending'), req('R3', 'Pending', new Date('2026-11-04T06:00:00Z'))], new Set(), now))
      .toEqual({ state: 'resolved', newRequestId: 'R3', newIndentAt: now });
  });
  it('does not treat an old request, or a new one that is itself rejected, as the new indent', () => {
    const waiting = { ...base, state: 'rejected_on_portal' as const, rejectedAt: T0 };
    expect(evaluateIssue(waiting, [req('R1', 'Rejected'), req('R3', 'Pending', new Date('2026-11-02T00:00:00Z'))], new Set(), now)).toBeNull();
    expect(evaluateIssue(waiting, [req('R1', 'Rejected'), req('R3', 'Rejected', new Date('2026-11-04T00:00:00Z'))], new Set(), now)).toBeNull();
    expect(evaluateIssue(waiting, [req('R1', 'Rejected'), req('R3', 'Pending', new Date('2026-11-04T00:00:00Z'))], new Set(['R3']), now)).toBeNull();
  });
  it('can go straight from raised to resolved if the new indent beats the rejection being seen', () => {
    const r = evaluateIssue(base, [req('R1', 'Rejected'), req('R3', 'Pending', new Date('2026-11-04T00:00:00Z'))], new Set(), now);
    expect(r).toMatchObject({ state: 'resolved', newRequestId: 'R3' });
  });
  it('picks the earliest new indent when two arrive together', () => {
    const waiting = { ...base, state: 'rejected_on_portal' as const, rejectedAt: T0 };
    const r = evaluateIssue(waiting, [req('R5', 'Pending', new Date('2026-11-04T10:00:00Z')), req('R4', 'Pending', new Date('2026-11-04T08:00:00Z'))], new Set(), now);
    expect(r?.newRequestId).toBe('R4');
  });
  it('never changes a finished issue', () => {
    for (const state of ['resolved', 'closed'] as const) expect(evaluateIssue({ ...base, state }, [req('R1', 'Rejected')], new Set(), now)).toBeNull();
  });
});

describe('the wait and the alert', () => {
  const waiting = { state: 'rejected_on_portal' as const, rejectedAt: new Date('2026-11-03T20:00:00Z') };   // 4 Nov 01:30 IST
  it('counts whole India calendar days from the day we saw the rejection', () => {
    expect(waitingDays(waiting, new Date('2026-11-04T10:00:00Z'))).toBe(0);
    expect(waitingDays(waiting, new Date('2026-11-06T00:00:00Z'))).toBe(2);
  });
  it('is overdue from the 2nd day with the default, and when the setting changes', () => {
    expect(isOverdue(waiting, 2, new Date('2026-11-05T10:00:00Z'))).toBe(false);
    expect(isOverdue(waiting, 2, new Date('2026-11-06T10:00:00Z'))).toBe(true);
    expect(isOverdue(waiting, 5, new Date('2026-11-06T10:00:00Z'))).toBe(false);
  });
  it('has no wait before the portal rejection is seen, or after the issue is finished', () => {
    expect(waitingDays({ state: 'issue_raised', rejectedAt: null })).toBeNull();
    expect(waitingDays({ state: 'resolved', rejectedAt: waiting.rejectedAt })).toBeNull();
    expect(isOverdue({ state: 'closed', rejectedAt: waiting.rejectedAt }, 2, now)).toBe(false);
  });
});

describe('reasons and the wait setting', () => {
  it('needs a real reason', () => {
    expect(() => cleanReason('  ')).toThrow(IssueInputError);
    expect(() => cleanReason('ab')).toThrow(IssueInputError);
    expect(() => cleanReason('x'.repeat(1001))).toThrow(IssueInputError);
    expect(() => cleanReason('bad \u0007 char')).toThrow(IssueInputError);
    expect(cleanReason('  Sugar is ten times too high  ')).toBe('Sugar is ten times too high');
  });
  const settings = () => {
    const store = new Map<string, unknown>(); const audit: unknown[] = [];
    const c = {
      settings: { findOne: async ({ _id }: { _id: string }) => (store.has(_id) ? { _id, value: store.get(_id) } : null), updateOne: async ({ _id }: { _id: string }, u: { $set: { value: unknown } }) => { store.set(_id, u.$set.value); } },
      auditLog: { insertOne: async (a: unknown) => { audit.push(a); } },
    } as unknown as IssueCollections;
    return { c, store, audit };
  };
  it('defaults to 2 days, saves a valid change with an audit entry, and refuses bad values', async () => {
    const { c, store, audit } = settings();
    expect(await getWaitDays(c)).toBe(2);
    await setWaitDays(c, 3, 'admin');
    expect(await getWaitDays(c)).toBe(3);
    expect(audit).toHaveLength(1);
    for (const bad of [0, 31, 1.5, Number.NaN, -1]) await expect(setWaitDays(c, bad, 'admin')).rejects.toThrow(IssueInputError);
    expect(store.get('issueWaitDays')).toBe(3);
  });
  it('falls back to 2 if the stored value is damaged', async () => {
    const { c, store } = settings();
    store.set('issueWaitDays', 'lots');
    expect(await getWaitDays(c)).toBe(2);
  });
});
