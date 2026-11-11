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
    expect(searchQuery('x'.repeat(200))).toHaveLength(100);
    expect(searchQuery()).toBe('');
  });

  it.each(['', ' ', '\t\n'])('does not build an unbounded blank query: %j', async (q) => {
    const db = fakeDb();
    expect(searchFilter(q)).toBeNull();
    expect(await searchDashboard(db.c, q, null)).toEqual({ hostels: [], orders: [], moreHostels: false, moreOrders: false });
    expect(db.find).not.toHaveBeenCalled();
    expect(db.aggregate).not.toHaveBeenCalled();
  });

  type Clause = Record<string, { $regex: string; $options: string }>;
  const matches = (filter: NonNullable<ReturnType<typeof searchFilter>>, doc: Record<string, string>) =>
    filter.$and.every((group) => (group.$or as Clause[]).some((cl) => { const [field, rx] = Object.entries(cl)[0]!; return new RegExp(rx.$regex, rx.$options).test(doc[field] ?? ''); }));
  const hostel = { hostelName: '36280901931-TGSWREIS (BOYS) KALWAKURTHY', hostelCode: '36280901931', requestId: 'IR202600007279', districtName: 'Nagarkurnool' };
  const girls = { hostelName: 'KALWAKURTHY(GIRLS)_JC', hostelCode: '96280901930', requestId: 'IR202600002012', districtName: 'Nagarkurnool' };

  it('finds a hostel in any format: name, code, both, any order, with punctuation, ID words or a request number', () => {
    for (const q of ['kalwakurthy', 'TGSWREIS (Boys) Kalwakurthy (36280901931)', '36280901931 kalwakurthy', 'kalwakurthy 3628', 'boys tgswreis', 'Hostel ID 36280901931', 'ir2026 7279', 'nagarkurnool boys', 'KALWAKURTHY   BOYS']) {
      expect(matches(searchFilter(q)!, hostel), q).toBe(true);
    }
    expect(matches(searchFilter('JC Kalwakurthy')!, girls)).toBe(true);
    expect(matches(searchFilter('kalwakurthygirls')!, girls)).toBe(true);      // letters run together, the name has punctuation between
    expect(matches(searchFilter('kalwakurthy 96280901930')!, girls)).toBe(true);
  });
  it('does not match other hostels, and a request ID alone points at its own order', () => {
    expect(matches(searchFilter('kalwakurthy girls')!, hostel)).toBe(false);
    expect(matches(searchFilter('IR202600007279')!, girls)).toBe(false);
    expect(matches(searchFilter('IR202600007279')!, hostel)).toBe(true);
  });
  it('only ever sends letters and digits to the database (no user-written patterns)', () => {
    const filter = searchFilter('A.*+?^${}()|[]\\ girls')!;
    const all = JSON.stringify(filter);
    expect(all).not.toMatch(/\.\*\+|\$\{|\(\)\|/);
    for (const group of filter.$and) for (const cl of group.$or as Clause[]) expect(Object.values(cl)[0]!.$regex.split('[^A-Za-z0-9]*').join('')).toMatch(/^[A-Za-z0-9]+$/);
  });
  it('ignores words that carry no meaning on their own', () => {
    expect(searchFilter('hostel id')).toBeNull();
    expect(searchFilter('ID 36280901931')!.$and).toHaveLength(1);
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
    const result = await searchDashboard(db.c, 'kgbv', null);
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
