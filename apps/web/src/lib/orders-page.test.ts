import { describe, expect, it, vi } from 'vitest';
import { loadOrdersPage } from './orders';

function fakeOrders() {
  const calls: { sort?: unknown; skip?: number; limit?: number } = {};
  const cur = { sort: (s: unknown) => { calls.sort = s; return cur; }, skip: (n: number) => { calls.skip = n; return cur; }, limit: (n: number) => { calls.limit = n; return cur; }, toArray: vi.fn(async () => [{ requestId: 'r' }]) };
  return { c: { orders: { find: () => cur } } as never, calls, cur };
}

describe('loadOrdersPage', () => {
  it('asks the database for just one page, in a stable order', async () => {
    const { c, calls } = fakeOrders();
    const r = await loadOrdersPage(c, {}, null, 3, 25, 80, new Date());
    expect(r.page).toBe(3); expect(r.pages).toBe(4);
    expect(calls).toMatchObject({ sort: { stageSince: 1, requestId: 1 }, skip: 50, limit: 25 });
  });
  it('keeps a page number that is too big or bad inside the real pages', async () => {
    expect((await loadOrdersPage(fakeOrders().c, {}, null, 99, 25, 30, new Date())).page).toBe(2);
    expect((await loadOrdersPage(fakeOrders().c, {}, null, NaN, 25, 30, new Date())).page).toBe(1);
    expect((await loadOrdersPage(fakeOrders().c, {}, null, -4, 25, 30, new Date())).page).toBe(1);
  });
  it('does not touch the database when there are no orders', async () => {
    const { c, cur } = fakeOrders();
    const r = await loadOrdersPage(c, {}, null, 1, 25, 0, new Date());
    expect(r.rows).toEqual([]); expect(r.pages).toBe(1); expect(cur.toArray).not.toHaveBeenCalled();
  });
});
