import { daysBetween, daysInStage, OPEN_STAGES, STAGE_LABEL, type OrderDoc, type Stage, type Collections } from '@anomaly/core';

export const TABS = [
  { key: 'open', label: 'Still in progress' },
  { key: 'pending', label: STAGE_LABEL.pending },
  { key: 'dc', label: STAGE_LABEL.dc },
  { key: 'transit', label: STAGE_LABEL.transit },
  { key: 'variation', label: STAGE_LABEL.variation },
  { key: 'received', label: STAGE_LABEL.received },
  { key: 'rejected', label: STAGE_LABEL.rejected },
  { key: 'cancelled', label: STAGE_LABEL.cancelled },
  { key: 'all', label: 'All orders' },
] as const;

export interface OrderParams { stage?: string; q?: string; month?: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Builds the Mongo filter from the screen's choices. Unknown stage values fall back to "still in progress". */
export function orderFilter(p: OrderParams) {
  const f: Record<string, unknown> = {};
  const tab = TABS.find((t) => t.key === p.stage)?.key ?? 'open';
  if (tab === 'open') f.stage = { $in: OPEN_STAGES };
  else if (tab !== 'all') f.stage = tab;
  const q = (p.q ?? '').trim().slice(0, 60);
  if (q) f.$or = [{ requestId: { $regex: escapeRe(q), $options: 'i' } }, { hostelName: { $regex: escapeRe(q), $options: 'i' } }, { hostelCode: q }];
  const m = /^(\d{4})-(\d{2})$/.exec(p.month ?? '');
  if (m) {
    const start = new Date(`${m[1]}-${m[2]}-01T00:00:00+05:30`);
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
    f.placedOn = { $gte: start, $lt: end };
  }
  return f;
}

/** Oldest stage first, so the orders that have waited longest are at the top. */
export async function loadOrders(c: Collections, p: OrderParams, limit = 0) {
  const filter = orderFilter(p);
  const cur = c.orders.find(filter as never).sort({ stageSince: 1 });
  if (limit) cur.limit(limit);
  return cur.toArray();
}

/** How many orders are in each stage (all months), for the tab counts. */
export async function stageCounts(c: Collections): Promise<Record<string, number>> {
  const rows = await c.orders.aggregate<{ _id: Stage; n: number }>([{ $group: { _id: '$stage', n: { $sum: 1 } } }]).toArray();
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const open = OPEN_STAGES.reduce((s, k) => s + (by[k] ?? 0), 0);
  return { open, all: rows.reduce((s, r) => s + r.n, 0), ...by };
}

/** Months (yyyy-mm, newest first) that have any orders, for the month picker. */
export async function orderMonths(c: Collections): Promise<string[]> {
  const rows = await c.orders.aggregate<{ _id: string }>([
    { $match: { placedOn: { $ne: null } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$placedOn', timezone: 'Asia/Kolkata' } } } },
    { $sort: { _id: -1 } },
  ]).toArray();
  return rows.map((r) => r._id);
}

export type Urgency = 'late' | 'watch' | 'ok';

/** Amber from a week in the same stage, red from two weeks. Only open stages can be late. */
export function urgency(o: Pick<OrderDoc, 'stage' | 'stageSince'>, now = new Date()): Urgency {
  if (!OPEN_STAGES.includes(o.stage)) return 'ok';
  const d = daysInStage(o, now);
  return d >= 15 ? 'late' : d >= 7 ? 'watch' : 'ok';
}

/** Whole days since the order was placed (India calendar). */
export const daysSincePlaced = (o: Pick<OrderDoc, 'placedOn'>, now = new Date()) =>
  o.placedOn ? daysBetween(o.placedOn, now) : null;

export const fmtDay = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';

export const sourceNote = (source: 'portal' | 'observed') =>
  source === 'portal' ? 'Date from the portal' : 'Date we first saw this status (the portal does not give one)';

/** The columns on the Orders screen, in the order the stages happen. "All" is a filter, not a stage. */
export const STAGE_COLUMNS = [
  { key: 'pending', label: 'Pending' },
  { key: 'dc', label: 'DC generated' },
  { key: 'transit', label: 'In transit' },
  { key: 'received', label: 'Acknowledged' },
  { key: 'variation', label: 'Variation' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

export interface StageCell { since: Date; days: number; current: boolean; source: 'portal' | 'observed' }

const MAIN_LINE = ['pending', 'dc', 'transit', 'received'] as const;
const SIDE_STAGES = ['variation', 'rejected', 'cancelled'] as const;

/** For each stage column: when the order reached it, how many days it stayed there, and whether it is still there.
 *  Main-line stages use the portal's own dates. The stop at cancel/reject (or variation) is the moment we first saw it,
 *  because the portal gives no date for that. A stage with no date comes back as null ("never reached"). */
export function stageCells(o: Pick<OrderDoc, 'stage' | 'stages' | 'reached'>, now = new Date()): Record<string, StageCell | null> {
  const out: Record<string, StageCell | null> = {};
  const r = o.reached ?? { pending: null, dc: null, transit: null, received: null };
  const open = OPEN_STAGES as readonly string[];
  const sideEntries = o.stages.filter((s) => (SIDE_STAGES as readonly string[]).includes(s.stage));
  MAIN_LINE.forEach((k, i) => {
    const since = r[k];
    if (!since) { out[k] = null; return; }
    const laterMain = MAIN_LINE.slice(i + 1).map((n) => r[n]).find((d): d is Date => !!d);
    const sideAfter = sideEntries.filter((s) => s.since > since).map((s) => s.since).sort((a, b) => a.getTime() - b.getTime())[0];
    const end = laterMain ?? sideAfter ?? now;
    out[k] = { since, days: daysBetween(since, end), current: !laterMain && !sideAfter && open.includes(k), source: 'portal' };
  });
  SIDE_STAGES.forEach((k) => {
    const idx = o.stages.findIndex((s) => s.stage === k);
    if (idx < 0) { out[k] = null; return; }
    const entry = o.stages[idx]!;
    const next = o.stages[idx + 1]?.since ?? now;
    out[k] = { since: entry.since, days: daysBetween(entry.since, next), current: o.stage === k, source: entry.source };
  });
  return out;
}
