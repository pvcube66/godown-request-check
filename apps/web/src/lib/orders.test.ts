import { describe, expect, it } from 'vitest';
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
