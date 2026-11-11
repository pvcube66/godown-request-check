import { describe, expect, it } from 'vitest';
import { normalizedDistrictCode } from '@anomaly/core';
import { hostelService, MEETING, monthlyCheckpoint, performance, supplierResolver, verdictFor, type PerfOrder } from './performance';

const d = (s: string) => new Date(`${s}T00:00:00+05:30`);
const NOW = d('2026-11-20');
type Over = Partial<PerfOrder> & { fill?: number | null; full?: [number, number] };
function order(district: string, hostel: string, stage: PerfOrder['stage'], o: Over = {}): PerfOrder {
  const { fill, full, ...rest } = o;
  return {
    requestId: `R-${hostel}-${stage}`, account: 'GDN-A', districtName: district, hostelCode: hostel, hostelName: `Hostel ${hostel}`, stage, stageSince: d('2026-11-15'), placedOn: d('2026-11-01'),
    reached: { pending: d('2026-11-01'), dc: null, transit: null, received: null },
    ...(fill !== undefined ? { fulfilment: { lineFill: fill, receivedFill: null, lines: 4, linesWithSupply: 4, fullLines: full ? full[0] : fill === 1 ? 4 : 2, variationLines: 0 } } : {}),
    ...rest,
  };
}
const names = { supplier: (_o: PerfOrder) => ({ key: 'S1', label: 'Supplier One' }), godown: (a: string) => (a === 'GDN-A' ? 'Godown A' : a) };

describe('which supplier served an order', () => {
  const nal = normalizedDistrictCode('Nalgonda');
  const mappings = [
    { districtCode: nal, supplierCode: 'S1', from: '2026-01-01', to: '2026-11-10' },
    { districtCode: nal, supplierCode: 'S2', from: '2026-11-10', to: null },
  ];
  const resolve = supplierResolver(mappings, (c) => `Name ${c}`);
  it('uses the mapping valid on the day the order was placed, so re-assigning a district keeps history', () => {
    expect(resolve({ districtName: 'Nalgonda', placedOn: d('2026-11-09'), stageSince: NOW }).key).toBe('S1');
    expect(resolve({ districtName: ' NALGONDA ', placedOn: d('2026-11-10'), stageSince: NOW })).toEqual({ key: 'S2', label: 'Name S2' });
  });
  it('says so when no supplier is mapped (never guesses)', () => {
    expect(resolve({ districtName: 'Warangal', placedOn: d('2026-11-09'), stageSince: NOW }).key).toBe('(unmapped)');
    expect(resolve({ districtName: 'Nalgonda', placedOn: d('2025-12-31'), stageSince: NOW }).key).toBe('(unmapped)');
  });
});

describe('meeting demand?', () => {
  it('meeting at 90%+ supplied with few long waits', () => expect(verdictFor(0.95, 0.05, 10)).toBe('meeting'));
  it('watch in between', () => { expect(verdictFor(0.85, 0.05, 10)).toBe('watch'); expect(verdictFor(0.95, 0.2, 10)).toBe('watch'); });
  it('not meeting below 75% supplied or with a quarter of its open orders stuck 15+ days', () => { expect(verdictFor(0.7, 0, 10)).toBe('not_meeting'); expect(verdictFor(0.95, 0.3, 10)).toBe('not_meeting'); });
  it('no data until some orders have been read', () => { expect(verdictFor(null, 0, 0)).toBe('no_data'); expect(verdictFor(0.99, 0, 0)).toBe('no_data'); });
  it('uses the published limits', () => expect(MEETING).toEqual({ fill: 0.9, notFill: 0.75, lateShare: 0.1, notLateShare: 0.25 }));
});

describe('performance table', () => {
  const orders = [
    order('Nalgonda', 'H1', 'received', { fill: 1, reached: { pending: d('2026-11-01'), dc: d('2026-11-03'), transit: d('2026-11-04'), received: d('2026-11-08') } }),
    order('Nalgonda', 'H2', 'transit', { fill: 0.5 }),
    order('Warangal', 'H3', 'pending', { stageSince: d('2026-11-01') }),                    // 19 days pending: 15+ backlog
    order('Warangal', 'H4', 'cancelled'),
    order('Warangal', 'H5', 'transit', { fill: 0.4, stageSince: d('2026-11-18') }),
  ];
  const { rows, overall } = performance(orders, 'district', NOW, names);
  it('averages each order’s fill, and counts only orders that were read', () => {
    const nal = rows.find((r) => r.label === 'Nalgonda')!;
    expect(nal).toMatchObject({ orders: 2, read: 2, fullOrders: 1 });
    expect(nal.fill).toBeCloseTo(0.75);
    expect(rows.find((r) => r.label === 'Warangal')).toMatchObject({ orders: 3, active: 2, read: 1 });
  });
  it('measures speed from the portal dates', () => {
    const nal = rows.find((r) => r.label === 'Nalgonda')!;
    expect(nal).toMatchObject({ daysToDc: 2, daysDcToDispatch: 1, daysToAcknowledge: 4 });
  });
  it('counts the open backlog by age and the rejected share', () => {
    const war = rows.find((r) => r.label === 'Warangal')!;
    expect(war).toMatchObject({ backlog: 2, backlog15: 1, backlog7: 1 });
    expect(war.rejectedShare).toBeCloseTo(1 / 3);
  });
  it('lists the weakest first and sets each against the average of everyone', () => {
    expect(rows[0]!.label).toBe('Warangal');
    expect(overall.fill).toBeCloseTo((1 + 0.5 + 0.4) / 3);
    expect(rows[0]!.vsAverage).toBeCloseTo((0.4 - overall.fill!) * 100);
    expect(overall.orders).toBe(orders.length);
  });
  it('the totals add up to the orders in view (so they reconcile with the orders list)', () => {
    expect(rows.reduce((n, r) => n + r.orders, 0)).toBe(orders.length);
  });
  it('groups by supplier, godown and hostel too', () => {
    expect(performance(orders, 'supplier', NOW, names).rows.map((r) => r.label)).toEqual(['Supplier One']);
    expect(performance(orders, 'godown', NOW, names).rows[0]!.label).toBe('Godown A');
    expect(performance(orders, 'hostel', NOW, names).rows).toHaveLength(5);
  });
  it('ignores impossible negative durations from bad dates', () => {
    const bad = order('X', 'H9', 'received', { fill: 1, reached: { pending: d('2026-11-10'), dc: d('2026-11-05'), transit: null, received: null } });
    expect(performance([bad], 'district', NOW, names).rows[0]!.daysToDc).toBeNull();
  });
  it('is empty and safe with no orders', () => {
    const r = performance([], 'supplier', NOW, names);
    expect(r.rows).toEqual([]); expect(r.overall).toMatchObject({ orders: 0, fill: null, verdict: 'no_data' });
  });
});

describe('hostels served and not served', () => {
  it('counts served, short and still waiting hostels', () => {
    const os = [order('N', 'H1', 'received', { fill: 1 }), order('N', 'H2', 'received', { fill: 0.5 }), order('N', 'H3', 'pending'), order('N', 'H4', 'cancelled', { fill: 1 }), order('N', 'H1', 'transit', { fill: 0.95 })];
    expect(hostelService(os)).toEqual({ served: 1, short: 1, waiting: 1 });
  });
});

describe('monthly checkpoint', () => {
  it('gives each supplier a verdict per placed month with the numbers behind it', () => {
    const os = [order('N', 'H1', 'received', { fill: 1 }), order('N', 'H2', 'received', { fill: 1, placedOn: d('2026-10-05') }), order('N', 'H3', 'received', { fill: 0.5, placedOn: d('2026-10-20') })];
    const cp = monthlyCheckpoint(os, NOW, names.supplier);
    expect(cp.months).toEqual(['2026-11', '2026-10']);
    expect(cp.rows[0]!.months['2026-11']).toMatchObject({ verdict: 'meeting', orders: 1, read: 1 });
    expect(cp.rows[0]!.months['2026-10']).toMatchObject({ orders: 2 });
    expect(cp.rows[0]!.months['2026-10']!.fill).toBeCloseTo(0.75);
  });
});

describe('supplier named by the portal', () => {
  it('wins over the district mapping', () => {
    const resolve = supplierResolver([{ districtCode: normalizedDistrictCode('Nalgonda'), supplierCode: 'S9', from: '2026-01-01', to: null }], (c) => `Mapped ${c}`);
    expect(resolve({ districtName: 'Nalgonda', placedOn: d('2026-11-01'), stageSince: NOW, supplier: { id: 'VND0001', name: 'Portal Supplier' } })).toEqual({ key: 'VND0001', label: 'Portal Supplier' });
    expect(resolve({ districtName: 'Nalgonda', placedOn: d('2026-11-01'), stageSince: NOW }).key).toBe('S9');
  });
});

describe('supplied quantities before dispatch are not a shortfall', () => {
  it('ignores a Delivery-note-stage order that has partial supplied quantities, but counts it once it is in transit', () => {
    const dc = order('Nalgonda', 'H9', 'dc', { fill: 0.2 });
    const transit = order('Nalgonda', 'H9', 'transit', { fill: 0.2 });
    expect(performance([dc], 'district', NOW, { supplier: () => ({ key: 'x', label: 'x' }), godown: (a) => a }).rows[0]!.fill).toBeNull();
    expect(performance([transit], 'district', NOW, { supplier: () => ({ key: 'x', label: 'x' }), godown: (a) => a }).rows[0]!.fill).toBeCloseTo(0.2);
  });
});
