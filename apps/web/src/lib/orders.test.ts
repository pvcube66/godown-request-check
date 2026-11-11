import { describe, expect, it, vi } from 'vitest';
import { orderFilter, orderMonth, parseIds } from './orders';
import { searchFilter } from './search';

describe('order search compatibility', () => {
  it.each(['261101', 'kgbv', 'REQ-42', 'A.*(girls)'])('preserves global search matches for %j', (q) => {
    expect(orderFilter({ q }).$and).toEqual(searchFilter(q)!.$and);
  });

  it('keeps the stage filter while searching', () => {
    expect(orderFilter({ stage: 'transit', q: '261101' })).toEqual({ stage: 'transit', ...searchFilter('261101') });
  });

  it('does not add search conditions for whitespace', () => {
    expect(orderFilter({ q: '  ' })).toEqual({});
  });
});

import { loadOrders, orderMonths, stageCounts } from './orders';

describe('district limits on orders', () => {
  const cursor = () => { const x = { sort: () => x, limit: () => x, toArray: async () => [] }; return x; };
  it('limits the list, the stage counts and the month picker', async () => {
    const find = vi.fn(() => cursor());
    const aggregate = vi.fn(() => ({ toArray: async () => [] }));
    const c = { orders: { find, aggregate } } as never;
    await loadOrders(c, { stage: 'transit' }, ['Nalgonda']);
    expect((find.mock.calls[0] as unknown as [{ $and: unknown[] }])[0].$and[0]).toEqual({ stage: 'transit' });
    await stageCounts(c, ['Nalgonda']); await orderMonths(c, ['Nalgonda']);
    for (const call of aggregate.mock.calls as unknown as [{ $match?: { $and?: unknown[] } }[]][]) expect(call[0][0]!.$match!.$and).toHaveLength(2);
  });
  it('adds nothing for administrators', async () => {
    const find = vi.fn(() => cursor());
    await loadOrders({ orders: { find } } as never, { stage: 'transit' }, null);
    expect(find).toHaveBeenCalledWith({ stage: 'transit' });
  });
});

import { orderFilter as filterFor, stageCells, STUCK_DAYS } from './orders';
import type { OrderDoc } from '@anomaly/core';

const d = (s: string) => new Date(`${s}T00:00:00+05:30`);
const order = (stage: OrderDoc['stage'], reached: Partial<OrderDoc['reached']>, extra: Pick<OrderDoc, 'stages'>): Pick<OrderDoc, 'stage' | 'stages' | 'reached'> => ({ stage, reached: { pending: null, dc: null, transit: null, received: null, ...reached }, ...extra });

describe('counting rules', () => {
  const now = d('2026-11-20');
  it('counts days while the order is still Pending, DC Generated or In-Transit', () => {
    const o = order('transit', { pending: d('2026-11-01'), dc: d('2026-11-05'), transit: d('2026-11-08') }, { stages: [{ stage: 'transit', since: d('2026-11-08'), source: 'portal' }] });
    const c = stageCells(o, now);
    expect(c.pending).toMatchObject({ kind: 'counted', days: 4, current: false });
    expect(c.dc).toMatchObject({ kind: 'counted', days: 3, current: false });
    expect(c.transit).toMatchObject({ kind: 'counted', days: 12, current: true });
  });
  it('stops the clock at Acknowledge: only its date, no days, and earlier stages end there', () => {
    const o = order('received', { pending: d('2026-11-01'), dc: d('2026-11-05'), transit: d('2026-11-08'), received: d('2026-11-15') }, { stages: [{ stage: 'received', since: d('2026-11-15'), source: 'portal' }] });
    const c = stageCells(o, now);
    expect(c.received).toMatchObject({ kind: 'ack', days: null, current: false });
    expect(c.transit).toMatchObject({ days: 7, current: false });
  });
  it('treats Rejected and Cancelled as final actions with no day count', () => {
    for (const stage of ['rejected', 'cancelled'] as const) {
      const o = order(stage, { pending: d('2026-11-01') }, { stages: [{ stage: 'pending', since: d('2026-11-01'), source: 'portal' }, { stage, since: d('2026-11-10'), source: 'observed' }] });
      const c = stageCells(o, now);
      expect(c[stage]).toMatchObject({ kind: 'final', days: null, current: true, source: 'observed' });
      expect(c.pending).toMatchObject({ kind: 'counted', days: 9 });          // the wait ended when it was cancelled
    }
  });
  it('counts Variation too (decision D4), growing while it is the current stage', () => {
    const o = order('variation', { pending: d('2026-11-01'), dc: d('2026-11-03'), transit: d('2026-11-05'), received: d('2026-11-08') }, { stages: [{ stage: 'variation', since: d('2026-11-08'), source: 'portal' }] });
    expect(stageCells(o, now).variation).toMatchObject({ kind: 'counted', days: 12, current: true });
  });
});

describe('stuck, district and godown filters', () => {
  const now = new Date('2026-11-20T10:00:00+05:30');
  it('7+ days means the stage began on or before the India day 7 days ago', () => {
    const f = filterFor({ stuck: String(STUCK_DAYS[0]) }, now) as { stageSince: { $lt: Date }; stage: { $in: string[] } };
    expect(f.stage.$in).toEqual(['pending', 'dc', 'transit', 'variation']);
    expect(f.stageSince.$lt).toEqual(d('2026-11-14'));          // 14 Nov began 6 days ago: not stuck. 13 Nov (7 days) is < 14 Nov: stuck.
  });
  it('keeps a chosen open stage, and shows nothing when the chosen stage can never be stuck', () => {
    expect((filterFor({ stuck: '15', stage: 'transit' }, now) as { stage: unknown }).stage).toEqual({ $in: ['transit'] });
    expect((filterFor({ stuck: '15', stage: 'received' }, now) as { stage: unknown }).stage).toEqual({ $in: [] });
  });
  it('ignores a stuck value that is not one of the allowed thresholds', () => {
    expect(filterFor({ stuck: '3' }, now)).toEqual({});
    expect(filterFor({ stuck: 'x' }, now)).toEqual({});
  });
  it('limits to a district (case and spacing do not matter) and a godown login', () => {
    const f = filterFor({ district: 'Jogulamba  Gadwal', account: 'GDN-JGL' }, now) as { districtName: RegExp; account: string };
    expect(f.districtName.test(' JOGULAMBA GADWAL ')).toBe(true);
    expect(f.districtName.test('Nalgonda')).toBe(false);
    expect(f.account).toBe('GDN-JGL');
  });
});

describe('orders opened from a supplier card', () => {
  it('lists exactly the card\'s own request IDs and drops anything that is not an ID', () => {
    expect(orderFilter({ ids: 'IR1, IR2,bad id,$ne,IR3' }).requestId).toEqual({ $in: ['IR1', 'IR2', 'IR3'] });
    expect(orderFilter({ ids: '' }).requestId).toBeUndefined();
    expect(parseIds(Array.from({ length: 100 }, (_, i) => `R${i}`).join(','))).toHaveLength(60);
  });
  it('filters by hostel code exactly, and refuses odd codes', () => {
    expect(orderFilter({ hostel: '36280901931' }).hostelCode).toBe('36280901931');
    expect(orderFilter({ hostel: '{"$ne":""}' }).hostelCode).toBeUndefined();
  });
  it('names the month of an order the way the flags do', () => {
    expect(orderMonth(new Date('2026-09-30T20:00:00Z'))).toBe('2026-10');      // 1 Oct in India
    expect(orderMonth(null)).toBe('');
  });
});
