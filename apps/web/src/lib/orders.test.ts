import { describe, expect, it, vi } from 'vitest';
import { orderFilter } from './orders';
import { searchFilter } from './search';

describe('order search compatibility', () => {
  it.each(['261101', 'kgbv', 'REQ-42', 'A.*(girls)'])('preserves global search matches for %j', (q) => {
    expect(orderFilter({ q }).$or).toEqual(searchFilter(q)!.$or);
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
