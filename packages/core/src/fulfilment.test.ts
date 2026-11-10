import { describe, expect, it, vi } from 'vitest';
import { summarizeFulfilment, syncFulfilment } from './fulfilment.js';
import { PortalAuthError, type PortalRequestItem } from './portalClient.js';
import type { AccountDoc, Collections } from './db.js';

const row = (name: string, requestedQuantity: number, extra: Partial<PortalRequestItem> = {}): PortalRequestItem => ({ name, requestedQuantity, ...extra });
const NOW = new Date('2026-11-10T00:00:00Z');

describe('how much was supplied and received', () => {
  const rows = [
    row('Rice', 100, { suppliedQuantity: 100, receivedQuantity: 100 }),
    row('Sugar', 50, { suppliedQuantity: 25, receivedQuantity: 20, variationQuantity: -5 }),
    row('Oil', 10, { suppliedQuantity: 0, receivedQuantity: 0 }),
    row('Salt', 0, { suppliedQuantity: 0 }),                                   // not asked for: ignored
  ];
  const f = summarizeFulfilment(rows, 'received', NOW);
  it('compares each item with itself and averages the lines (never adds kilos to packets)', () => {
    expect(f.lines).toBe(3); expect(f.linesWithSupply).toBe(3); expect(f.fullLines).toBe(1);
    expect(f.lineFill).toBeCloseTo((1 + 0.5 + 0) / 3);
  });
  it('measures received against supplied only for lines that were supplied', () => {
    expect(f.receivedFill).toBeCloseTo((1 + 0.8) / 2);
  });
  it('counts lines with a variation, and lists shortfalls with the biggest first', () => {
    expect(f.variationLines).toBe(1);
    expect(f.short.map((s) => s.name)).toEqual(['Oil', 'Sugar']);
    expect(f.short[1]).toMatchObject({ requested: 50, supplied: 25 });
  });
  it('caps a line at fully supplied when more than requested was sent', () => {
    expect(summarizeFulfilment([row('Rice', 10, { suppliedQuantity: 15 })], 'transit', NOW).lineFill).toBe(1);
  });
  it('has no received figure before the hostel has received, and none when the portal gives no supplied quantities', () => {
    expect(summarizeFulfilment(rows, 'transit', NOW).receivedFill).toBeNull();
    const none = summarizeFulfilment([row('Rice', 10)], 'dc', NOW);
    expect(none).toMatchObject({ lineFill: null, linesWithSupply: 0, fullLines: 0, short: [] });
  });
  it('limits the shortfall list to 15 lines', () => {
    const many = Array.from({ length: 30 }, (_, i) => row(`Item ${i}`, 10, { suppliedQuantity: 1 }));
    expect(summarizeFulfilment(many, 'dc', NOW).short).toHaveLength(15);
  });
});

describe('reading the item lists', () => {
  const acct = { username: 'GDN-X' } as AccountDoc;
  function fake(orders: { requestId: string; stage: string; fulfilment?: { stage: string } }[]) {
    const updates: { filter: unknown; set: unknown }[] = [];
    let seenFilter: unknown;
    const c = { orders: {
      find: (filter: unknown) => { seenFilter = filter; return { sort: () => ({ limit: (n: number) => ({ toArray: async () => orders.slice(0, n) }) }) }; },
      updateOne: async (filter: unknown, u: { $set: unknown }) => { updates.push({ filter, set: u.$set }); },
    } } as unknown as Collections;
    return { c, updates, filter: () => seenFilter };
  }
  it('asks only for orders with a delivery note that have not been read at their current stage', async () => {
    const t = fake([]);
    await syncFulfilment(t.c, acct, 'tok', 10, 0, async () => []);
    expect(t.filter()).toMatchObject({ account: 'GDN-X', stage: { $in: ['dc', 'transit', 'received', 'variation'] } });
    expect(JSON.stringify(t.filter())).toContain('$expr');
  });
  it('stores a summary per order, keyed to the stage it was read at, and respects the limit', async () => {
    const t = fake([{ requestId: 'R1', stage: 'transit' }, { requestId: 'R2', stage: 'received' }, { requestId: 'R3', stage: 'dc' }]);
    const read = vi.fn(async () => [row('Rice', 10, { suppliedQuantity: 10 })]);
    expect(await syncFulfilment(t.c, acct, 'tok', 2, 0, read)).toBe(2);
    expect(read).toHaveBeenCalledTimes(2);
    expect(t.updates[0]!.filter).toEqual({ account: 'GDN-X', requestId: 'R1', stage: 'transit' });
  });
  it('skips an order whose read failed and carries on, but stops on a rejected login', async () => {
    const t = fake([{ requestId: 'R1', stage: 'dc' }, { requestId: 'R2', stage: 'dc' }]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const flaky = vi.fn(async (_t: string, id: string) => { if (id === 'R1') throw new Error('HTTP 500'); return [row('Rice', 10, { suppliedQuantity: 10 })]; });
    expect(await syncFulfilment(t.c, acct, 'tok', 10, 0, flaky)).toBe(1);
    expect(t.updates).toHaveLength(1);
    const dead = vi.fn(async () => { throw new PortalAuthError('Token rejected'); });
    await expect(syncFulfilment(t.c, acct, 'tok', 10, 0, dead)).rejects.toBeInstanceOf(PortalAuthError);
    err.mockRestore();
  });
});
