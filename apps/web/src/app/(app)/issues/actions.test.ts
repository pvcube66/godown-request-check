import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAccess, visibleDistricts, anomaliesFind, anomaliesUpdate, issuesFindOne, ordersFindOne, requestsFindOne, raiseIssue, closeIssue, addRemark, setWaitDays } = vi.hoisted(() => ({
  requireAccess: vi.fn(), visibleDistricts: vi.fn(), anomaliesFind: vi.fn(), anomaliesUpdate: vi.fn(), issuesFindOne: vi.fn(), ordersFindOne: vi.fn(), requestsFindOne: vi.fn(),
  raiseIssue: vi.fn(), closeIssue: vi.fn(), addRemark: vi.fn(), setWaitDays: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/viewer', () => ({ requireAccess, visibleDistricts, actorOf: (v: { id: string }) => `user:${v.id}` }));
vi.mock('@/lib/db', () => ({ getDb: async () => ({
  anomalies: { find: () => ({ toArray: anomaliesFind }), updateMany: anomaliesUpdate },
  issues: { findOne: issuesFindOne }, orders: { findOne: ordersFindOne }, requests: { findOne: requestsFindOne },
}) }));
vi.mock('@anomaly/core', async (orig) => ({ ...(await orig<typeof import('@anomaly/core')>()), raiseIssue, closeIssue, addRemark, setWaitDays }));

import { addRemarkAction, closeIssueAction, flagOrderAction, raiseIssueAction, waitDaysAction } from './actions';

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const flag = (key: string, month = '2026-12') => ({ key, godownId: 1, hostelCode: 'H1', hostelName: 'H', districtName: 'Nalgonda', month });
const operator = { id: 'u1', name: 'Vikas', role: 'operator', districtCodes: ['D-1'] };

beforeEach(() => {
  vi.clearAllMocks();
  requireAccess.mockResolvedValue(operator); visibleDistricts.mockResolvedValue(['Nalgonda']);
  raiseIssue.mockResolvedValue({ issueId: 'I1' });
});

describe('raising an issue from a flag', () => {
  it('is refused for read-only logins, and nothing is read or written', async () => {
    requireAccess.mockRejectedValue(new Error('read-only'));
    const r = await raiseIssueAction(['k1'], 'sugar is wrong');
    expect(r.ok).toBe(false);
    expect(anomaliesFind).not.toHaveBeenCalled(); expect(raiseIssue).not.toHaveBeenCalled();
  });
  it('refuses flags that are outside the person’s districts (fewer found than sent)', async () => {
    anomaliesFind.mockResolvedValue([flag('k1')]);
    const r = await raiseIssueAction(['k1', 'k-other-district'], 'sugar is wrong');
    expect(r.ok).toBe(false);
    expect(raiseIssue).not.toHaveBeenCalled(); expect(anomaliesUpdate).not.toHaveBeenCalled();
  });
  it('raises one issue per hostel and month, then marks the flags', async () => {
    anomaliesFind.mockResolvedValue([flag('k1'), flag('k2'), flag('k3', '2027-01')]);
    const r = await raiseIssueAction(['k1', 'k2', 'k3', 'k1'], 'sugar is wrong');
    expect(r).toMatchObject({ ok: true, issueId: 'I1' });
    expect(raiseIssue).toHaveBeenCalledTimes(2);
    expect(anomaliesUpdate).toHaveBeenCalledWith({ key: { $in: ['k1', 'k2', 'k3'] } }, { $set: expect.objectContaining({ status: 'confirmed' }) });
  });
  it('does not mark flags if recording the issue fails (bad reason)', async () => {
    anomaliesFind.mockResolvedValue([flag('k1')]);
    const { IssueInputError } = await import('@anomaly/core');
    raiseIssue.mockRejectedValue(new IssueInputError('Please write a little more'));
    const r = await raiseIssueAction(['k1'], 'x');
    expect(r).toEqual({ ok: false, message: 'Please write a little more' });
    expect(anomaliesUpdate).not.toHaveBeenCalled();
  });
  it.each([[[]], [[1]], [Array.from({ length: 101 }, (_, i) => `k${i}`)]])('rejects malformed key lists', async (keys) => {
    expect((await raiseIssueAction(keys as string[], 'a reason')).ok).toBe(false);
    expect(raiseIssue).not.toHaveBeenCalled();
  });
});

describe('other issue actions stay inside the person’s districts', () => {
  it('flagging an order needs the order in their districts', async () => {
    ordersFindOne.mockResolvedValue(null); requestsFindOne.mockResolvedValue({ requestId: 'R9' });
    expect(await flagOrderAction({}, form({ requestId: 'R9', reason: 'looks odd' }))).toHaveProperty('error');
    expect(raiseIssue).not.toHaveBeenCalled();
    ordersFindOne.mockResolvedValue({ requestId: 'R9' });
    expect(await flagOrderAction({}, form({ requestId: 'R9', reason: 'looks odd' }))).toHaveProperty('success');
    expect(raiseIssue).toHaveBeenCalledOnce();
  });
  it('remarks need the issue or order in their districts, and a known target type', async () => {
    issuesFindOne.mockResolvedValue(null);
    expect(await addRemarkAction({}, form({ targetType: 'issue', targetId: 'I1', text: 'hello', outcome: '' }))).toHaveProperty('error');
    expect(await addRemarkAction({}, form({ targetType: 'user', targetId: 'x', text: 'hello', outcome: '' }))).toHaveProperty('error');
    expect(addRemark).not.toHaveBeenCalled();
    issuesFindOne.mockResolvedValue({ issueId: 'I1' });
    expect(await addRemarkAction({}, form({ targetType: 'issue', targetId: 'I1', text: 'hello', outcome: 'reached' }))).toHaveProperty('success');
    expect(addRemark).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ targetType: 'issue', actor: 'user:u1' }));
  });
  it('closing needs the issue in their districts', async () => {
    issuesFindOne.mockResolvedValue(null);
    expect(await closeIssueAction({}, form({ issueId: 'I1', note: 'not needed' }))).toHaveProperty('error');
    expect(closeIssue).not.toHaveBeenCalled();
  });
  it('read-only logins cannot do any of them', async () => {
    requireAccess.mockRejectedValue(new Error('read-only'));
    for (const r of [await flagOrderAction({}, form({ requestId: 'R9', reason: 'odd odd' })), await addRemarkAction({}, form({ targetType: 'issue', targetId: 'I', text: 'hello', outcome: '' })), await closeIssueAction({}, form({ issueId: 'I', note: 'because' }))]) expect(r).toHaveProperty('error');
  });
  it('only an administrator can change the wait days, and bad numbers are refused', async () => {
    requireAccess.mockRejectedValue(new Error('admins only'));
    expect(await waitDaysAction({}, form({ days: '3' }))).toHaveProperty('error');
    requireAccess.mockResolvedValue({ ...operator, role: 'admin' });
    expect(await waitDaysAction({}, form({ days: '3' }))).toHaveProperty('success');
    expect(setWaitDays).toHaveBeenCalledWith(expect.anything(), 3, 'user:u1');
  });
});
