import { describe, expect, it, vi } from 'vitest';
import type { Collections } from '@anomaly/core';
import { searchDashboard, searchFilter, searchQuery, SEARCH_LIMIT } from './search';

function fakeDb(hostelRows: unknown[] = [], orderRows: unknown[] = []) {
  const aggregate = vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(hostelRows) }));
  const toArray = vi.fn().mockResolvedValue(orderRows);
  const limit = vi.fn(() => ({ toArray }));
  const sort = vi.fn(() => ({ limit }));
  const find = vi.fn(() => ({ sort }));
  const c = { requests: { aggregate }, orders: { find } } as unknown as Pick<Collections, 'requests' | 'orders'>;
  return { c, aggregate, find, sort, limit };
}

describe('dashboard search', () => {
  it('trims and bounds queries consistently', () => {
    expect(searchQuery('  KGBV Maldakal  ')).toBe('KGBV Maldakal');
    expect(searchQuery('x'.repeat(100))).toHaveLength(60);
    expect(searchQuery()).toBe('');
  });

  it.each(['', ' ', '\t\n'])('does not build an unbounded blank query: %j', async (q) => {
    const db = fakeDb();
    expect(searchFilter(q)).toBeNull();
    expect(await searchDashboard(db.c, q, null)).toEqual({ hostels: [], orders: [], moreHostels: false, moreOrders: false });
    expect(db.find).not.toHaveBeenCalled();
    expect(db.aggregate).not.toHaveBeenCalled();
  });

  it('supports literal case-insensitive substrings for names, codes, and request IDs', () => {
    const filter = searchFilter('  kGbV  ')!;
    expect(filter.$or.map((f) => Object.keys(f)[0])).toEqual(['hostelName', 'hostelCode', 'requestId']);
    for (const clause of filter.$or) {
      const { $regex, $options } = Object.values(clause)[0]!;
      expect(new RegExp($regex, $options).test('2611010007-KGBV Maldakal')).toBe(true);
    }
    expect(searchFilter('261101')!.$or[1]).toEqual({ hostelCode: { $regex: '261101', $options: 'i' } });
    expect(searchFilter('REQ-42')!.$or[2]).toEqual({ requestId: { $regex: 'REQ-42', $options: 'i' } });
  });

  it('escapes every regex metacharacter instead of executing user patterns', () => {
    const input = 'A.*+?^${}()|[]\\';
    const regex = searchFilter(input)!.$or[0]!.hostelName!;
    expect(new RegExp(regex.$regex, regex.$options).test(`before ${input} after`)).toBe(true);
    expect(new RegExp(regex.$regex, regex.$options).test('Anything')).toBe(false);
  });

  it('uses the same query for hostels and orders and groups by godown as well as code', async () => {
    const db = fakeDb();
    await searchDashboard(db.c, 'Maldakal', null);
    expect(db.find).toHaveBeenCalledWith(searchFilter('Maldakal'));
    const pipeline = db.aggregate.mock.calls[0] as unknown as [Record<string, unknown>[]];
    expect(pipeline[0][0]).toEqual({ $match: searchFilter('Maldakal') });
    expect(pipeline[0]).toContainEqual(expect.objectContaining({ $group: expect.objectContaining({ _id: { godownId: '$godownId', hostelCode: '$hostelCode' } }) }));
    expect(pipeline[0]).toContainEqual({ $limit: SEARCH_LIMIT + 1 });
    expect(db.limit).toHaveBeenCalledWith(SEARCH_LIMIT + 1);
  });

  it('caps each section and reports that more matches exist', async () => {
    const db = fakeDb(Array.from({ length: 21 }, (_, id) => ({ hostelCode: String(id) })), Array.from({ length: 21 }, (_, id) => ({ requestId: String(id) })));
    const result = await searchDashboard(db.c, 'hostel', null);
    expect(result.hostels).toHaveLength(20);
    expect(result.orders).toHaveLength(20);
    expect(result.moreHostels).toBe(true);
    expect(result.moreOrders).toBe(true);
  });

  it('does not claim additional results when all matches fit', async () => {
    const result = await searchDashboard(fakeDb([{ hostelCode: '1' }]).c, '1', null);
    expect(result.hostels).toHaveLength(1);
    expect(result.orders).toEqual([]);
    expect(result.moreHostels).toBe(false);
    expect(result.moreOrders).toBe(false);
  });
});

describe('district limits', () => {
  it('puts the district limit in both database queries, around the text filter', async () => {
    const db = fakeDb();
    await searchDashboard(db.c, 'Maldakal', ['Nalgonda']);
    const arg = db.find.mock.calls[0] as unknown as [{ $and: [unknown, { districtName: { $in: RegExp[] } }] }];
    expect(arg[0].$and[0]).toEqual(searchFilter('Maldakal'));
    expect(arg[0].$and[1].districtName.$in[0]!.test('NALGONDA')).toBe(true);
    const pipeline = db.aggregate.mock.calls[0] as unknown as [{ $match: { $and: unknown[] } }[]];
    expect(pipeline[0][0]!.$match.$and).toHaveLength(2);
  });
  it('an operator with no districts matches nothing', async () => {
    const db = fakeDb();
    await searchDashboard(db.c, 'Maldakal', []);
    const arg = db.find.mock.calls[0] as unknown as [{ $and: [unknown, { districtName: { $in: RegExp[] } }] }];
    expect(arg[0].$and[1].districtName.$in).toEqual([]);
  });
});
