import { daysBetween, istDay, normalizedDistrictCode, scoped, type Collections, type MappingDoc, type OrderDoc, type Stage } from '@anomaly/core';
import { orderFilter } from './orders';

export type By = 'supplier' | 'godown' | 'district' | 'hostel';
export const BYS: { key: By; label: string }[] = [
  { key: 'supplier', label: 'Supplier view' },
  { key: 'godown', label: 'Godown' },
  { key: 'district', label: 'District' },
  { key: 'hostel', label: 'Hostel view' },
];

/** The numbers behind "is this supplier meeting demand?". Shown on the page so nobody has to guess. */
export const MEETING = { fill: 0.9, notFill: 0.75, lateShare: 0.1, notLateShare: 0.25 } as const;

export type PerfOrder = Pick<OrderDoc, 'supplier' | 'account' | 'districtName' | 'hostelCode' | 'hostelName' | 'stage' | 'stageSince' | 'reached' | 'placedOn'> & {
  fulfilment?: Pick<NonNullable<OrderDoc['fulfilment']>, 'lineFill' | 'receivedFill' | 'lines' | 'linesWithSupply' | 'fullLines' | 'variationLines'>;
};

export type Verdict = 'meeting' | 'watch' | 'not_meeting' | 'no_data';
export const VERDICT_TEXT: Record<Verdict, string> = { meeting: 'On track', watch: 'Needs attention', not_meeting: 'Falling short', no_data: 'Not enough data yet' };

export interface PerfRow {
  key: string; label: string; filter: { district?: string; account?: string; hostel?: string };
  orders: number;                 // every order
  active: number;                 // orders that were not rejected or cancelled
  read: number;                   // orders whose supplied quantities we have read
  fill: number | null;            // average share of each line supplied (0 to 1)
  fullOrders: number;             // read orders where every line was supplied in full
  receivedFill: number | null;    // of what was supplied, the share the hostel received
  daysToDc: number | null; daysDcToDispatch: number | null; daysToAcknowledge: number | null;
  backlog: number; backlog7: number; backlog15: number;     // orders still Pending / DC Generated / In-Transit
  rejectedShare: number;          // rejected + cancelled, of all orders
  variationShare: number | null;  // orders with a variation, of orders already received
  vsAverage: number | null;       // fill minus the average of everyone in view, in percentage points
  verdict: Verdict;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const MOVING: Stage[] = ['pending', 'dc', 'transit'];

/** Which supplier served an order: the one the portal names on its delivery note; otherwise the supplier mapped to its district on the day it was placed (history is kept). */
export function supplierResolver(mappings: readonly Pick<MappingDoc, 'districtCode' | 'supplierCode' | 'from' | 'to'>[], supplierName: (code: string) => string) {
  return (o: Pick<PerfOrder, 'districtName' | 'placedOn' | 'stageSince'> & { supplier?: { id: string; name: string } }): { key: string; label: string } => {
    if (o.supplier) return { key: o.supplier.id, label: o.supplier.name };         // the supplier the portal names on the delivery note wins
    const day = istDay(o.placedOn ?? o.stageSince);
    const code = normalizedDistrictCode(o.districtName);
    const m = mappings.find((x) => x.districtCode === code && x.from <= day && (x.to === null || day < x.to));
    return m ? { key: m.supplierCode, label: supplierName(m.supplierCode) } : { key: '(unmapped)', label: 'No supplier mapped yet' };
  };
}

export function verdictFor(fill: number | null, lateShare: number, read: number): Verdict {
  if (read === 0 || fill === null) return 'no_data';
  if (fill < MEETING.notFill || lateShare > MEETING.notLateShare) return 'not_meeting';
  if (fill >= MEETING.fill && lateShare <= MEETING.lateShare) return 'meeting';
  return 'watch';
}

function rowOf(key: string, label: string, filter: PerfRow['filter'], orders: readonly PerfOrder[], now: Date): Omit<PerfRow, 'vsAverage'> {
  const active = orders.filter((o) => o.stage !== 'rejected' && o.stage !== 'cancelled');
  const read = active.filter((o) => o.fulfilment?.lineFill != null);
  const moving = active.filter((o) => MOVING.includes(o.stage));
  const age = (o: PerfOrder) => daysBetween(o.stageSince, now);
  const diff = (a: Date | null | undefined, b: Date | null | undefined) => (a && b ? daysBetween(a, b) : null);
  const nums = (f: (o: PerfOrder) => number | null) => mean(active.map(f).filter((n): n is number => n !== null && n >= 0));
  const gotIt = active.filter((o) => o.stage === 'received' || o.stage === 'variation');
  const backlog15 = moving.filter((o) => age(o) >= 15).length;
  const fill = mean(read.map((o) => o.fulfilment!.lineFill!));
  return {
    key, label, filter, orders: orders.length, active: active.length, read: read.length, fill,
    fullOrders: read.filter((o) => o.fulfilment!.fullLines === o.fulfilment!.linesWithSupply && o.fulfilment!.linesWithSupply > 0).length,
    receivedFill: mean(active.map((o) => o.fulfilment?.receivedFill).filter((n): n is number => n != null)),
    daysToDc: nums((o) => diff(o.reached?.pending, o.reached?.dc)),
    daysDcToDispatch: nums((o) => diff(o.reached?.dc, o.reached?.transit)),
    daysToAcknowledge: nums((o) => diff(o.reached?.transit, o.reached?.received)),
    backlog: moving.length, backlog7: moving.filter((o) => age(o) >= 7).length, backlog15,
    rejectedShare: orders.length ? (orders.length - active.length) / orders.length : 0,
    variationShare: gotIt.length ? gotIt.filter((o) => o.stage === 'variation' || (o.fulfilment?.variationLines ?? 0) > 0).length / gotIt.length : null,
    verdict: verdictFor(fill, moving.length ? backlog15 / moving.length : 0, read.length),
  };
}

/** One row per group, with each group's fill set against the average of all orders in view. */
export function performance(
  orders: readonly PerfOrder[], by: By, now: Date,
  names: { supplier: (o: PerfOrder) => { key: string; label: string }; godown: (account: string) => string },
): { rows: PerfRow[]; overall: PerfRow } {
  const groups = new Map<string, { label: string; filter: PerfRow['filter']; orders: PerfOrder[] }>();
  for (const o of orders) {
    let key: string, label: string, filter: PerfRow['filter'];
    if (by === 'supplier') ({ key, label } = names.supplier(o)), filter = {};
    else if (by === 'godown') key = o.account, label = names.godown(o.account), filter = { account: o.account };
    else if (by === 'district') key = normalizedDistrictCode(o.districtName) || '(none)', label = o.districtName.trim() || 'No district', filter = { district: o.districtName.trim() };
    else key = o.hostelCode, label = `${o.hostelName} (${o.hostelCode})`, filter = { hostel: o.hostelCode };
    const g = groups.get(key) ?? groups.set(key, { label, filter, orders: [] }).get(key)!;
    g.orders.push(o);
  }
  const overall = { ...rowOf('all', 'All in view', {}, orders, now), vsAverage: null } as PerfRow;
  const rows = [...groups.entries()].map(([key, g]) => {
    const r = rowOf(key, g.label, g.filter, g.orders, now);
    return { ...r, vsAverage: r.fill !== null && overall.fill !== null ? (r.fill - overall.fill) * 100 : null } as PerfRow;
  }).sort((a, b) => (a.fill ?? 2) - (b.fill ?? 2) || b.backlog15 - a.backlog15 || b.orders - a.orders || a.label.localeCompare(b.label));   // weakest first
  return { rows, overall };
}

/** Month-by-month verdict for each supplier (month = the month the order was placed in, India time). */
export function monthlyCheckpoint(orders: readonly PerfOrder[], now: Date, supplier: (o: PerfOrder) => { key: string; label: string }) {
  const cells = new Map<string, Map<string, PerfOrder[]>>();
  const labels = new Map<string, string>();
  for (const o of orders) {
    const s = supplier(o); labels.set(s.key, s.label);
    const month = istDay(o.placedOn ?? o.stageSince).slice(0, 7);
    const byMonth = cells.get(s.key) ?? cells.set(s.key, new Map()).get(s.key)!;
    (byMonth.get(month) ?? byMonth.set(month, []).get(month)!).push(o);
  }
  const months = [...new Set([...cells.values()].flatMap((m) => [...m.keys()]))].sort().reverse();
  const rows = [...cells.entries()].map(([key, byMonth]) => ({
    key, label: labels.get(key)!,
    months: Object.fromEntries([...byMonth.entries()].map(([m, os]) => { const r = rowOf(key, '', {}, os, now); return [m, { verdict: r.verdict, fill: r.fill, read: r.read, orders: r.orders, backlog15: r.backlog15 }]; })),
  })).sort((a, b) => a.label.localeCompare(b.label));
  return { months, rows };
}

export interface HostelService { served: number; short: number; waiting: number }
/** Of the hostels in a group: how many were served in full, how many were short, how many are still waiting for anything. */
export function hostelService(orders: readonly PerfOrder[]): HostelService {
  const by = new Map<string, PerfOrder[]>();
  for (const o of orders) if (o.stage !== 'rejected' && o.stage !== 'cancelled') (by.get(o.hostelCode) ?? by.set(o.hostelCode, []).get(o.hostelCode)!).push(o);
  const out = { served: 0, short: 0, waiting: 0 };
  for (const os of by.values()) {
    const read = os.filter((o) => o.fulfilment?.lineFill != null);
    if (!read.length) out.waiting++;
    else if (read.every((o) => (o.fulfilment!.lineFill ?? 0) >= MEETING.fill)) out.served++;
    else out.short++;
  }
  return out;
}

export async function loadPerfOrders(c: Collections, names: string[] | null, month?: string): Promise<PerfOrder[]> {
  return c.orders.find(scoped(orderFilter({ month }), names) as never, { projection: {
    supplier: 1, account: 1, districtName: 1, hostelCode: 1, hostelName: 1, stage: 1, stageSince: 1, reached: 1, placedOn: 1,
    'fulfilment.lineFill': 1, 'fulfilment.receivedFill': 1, 'fulfilment.lines': 1, 'fulfilment.linesWithSupply': 1, 'fulfilment.fullLines': 1, 'fulfilment.variationLines': 1,
  } }).toArray() as unknown as Promise<PerfOrder[]>;
}

export async function loadSupplierResolver(c: Collections) {
  const [mappings, suppliers] = await Promise.all([c.mappings.find({}).toArray(), c.suppliers.find({}).toArray()]);
  const name = new Map(suppliers.map((s) => [s.code, s.name]));
  return { resolve: supplierResolver(mappings, (code) => name.get(code) ?? code), mapped: mappings.length > 0 };
}
