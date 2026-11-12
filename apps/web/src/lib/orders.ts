import { ACTIVE_STATES, daysBetween, daysInStage, districtRegex, istDay, OPEN_STAGES, scoped, STAGE_LABEL, type OrderDoc, type Stage, type Collections } from '@anomaly/core';
import { searchFilter } from './search';

export const TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'dc', label: 'DC Generated' },
  { key: 'transit', label: 'In-Transit' },
  { key: 'received', label: 'Acknowledge' },
  { key: 'variation', label: 'Variation' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

export interface OrderParams { stage?: string; q?: string; month?: string; district?: string; account?: string; stuck?: string; ids?: string; hostel?: string }

/** Request IDs sent by a card (comma separated, letters, digits, dash and underscore only, at most 60), so the list shows exactly the orders the card counted. */
export const parseIds = (v?: string): string[] => (v ?? '').split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{1,40}$/.test(x)).slice(0, 60);

/** "Stuck" thresholds, in whole days at the same open stage. They match the amber (7) and red (15) shading. */
export const STUCK_DAYS = [7, 15] as const;


/** Builds the Mongo filter from the screen's choices. Unknown stage values show all orders. */
export function orderFilter(p: OrderParams, now = new Date()) {
  const f: Record<string, unknown> = {};
  const tab = TABS.find((t) => t.key === p.stage)?.key ?? 'all';
  if (tab !== 'all') f.stage = tab;
  const search = searchFilter(p.q ?? '');
  if (search) f.$and = search.$and;
  const ids = parseIds(p.ids);
  if (ids.length) f.requestId = { $in: ids };
  if (p.hostel && /^[A-Za-z0-9_-]{1,40}$/.test(p.hostel)) f.hostelCode = p.hostel;
  const m = /^(\d{4})-(\d{2})$/.exec(p.month ?? '');
  if (m) {
    const start = new Date(`${m[1]}-${m[2]}-01T00:00:00+05:30`);
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
    f.placedOn = { $gte: start, $lt: end };
  }
  if (p.district) f.districtName = districtRegex(p.district);
  if (p.account) f.account = p.account;
  const stuck = Number(p.stuck);
  if ((STUCK_DAYS as readonly number[]).includes(stuck)) {
    // days in stage >= stuck  <=>  the stage began on or before the India day that is `stuck` days ago
    const day = new Date(`${istDay(now)}T00:00:00+05:30`);
    day.setUTCDate(day.getUTCDate() - stuck + 1);
    const wanted = typeof f.stage === 'string' ? (OPEN_STAGES.includes(f.stage as Stage) ? [f.stage] : []) : OPEN_STAGES;   // only open stages can be stuck
    f.stage = { $in: wanted };
    f.stageSince = { $lt: day };
  }
  return f;
}

/** Oldest stage first, so the orders that have waited longest are at the top. */
export async function loadOrders(c: Collections, p: OrderParams, names: string[] | null, limit = 0, now = new Date()) {
  const filter = scoped(orderFilter(p, now), names);
  const cur = c.orders.find(filter as never).sort({ stageSince: 1, requestId: 1 });
  if (limit) cur.limit(limit);
  return cur.toArray();
}

/** One page of the same list, cut in the database (the whole list is never loaded). Same order as loadOrders, with the request number breaking ties so a page never repeats or skips an order. */
export async function loadOrdersPage(c: Collections, p: OrderParams, names: string[] | null, pageNo: number, pageSize: number, total: number, now = new Date()) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(pageNo) || 1), pages);
  const filter = scoped(orderFilter(p, now), names);
  const rows = total ? await c.orders.find(filter as never).sort({ stageSince: 1, requestId: 1 }).skip((page - 1) * pageSize).limit(pageSize).toArray() : [];
  return { rows, page, pages };
}

export async function countOrders(c: Collections, p: OrderParams, names: string[] | null, now = new Date()) {
  return c.orders.countDocuments(scoped(orderFilter(p, now), names) as never);
}

/** How many orders are in each stage (all months), for the tab counts. */
export async function stageCounts(c: Collections, names: string[] | null, only: Omit<OrderParams, 'stage' | 'stuck'> = {}): Promise<Record<string, number>> {
  const base = orderFilter({ district: only.district, account: only.account, q: only.q, month: only.month, ids: only.ids, hostel: only.hostel });
  const rows = await c.orders.aggregate<{ _id: Stage; n: number }>([{ $match: scoped(base, names) }, { $group: { _id: '$stage', n: { $sum: 1 } } }]).toArray();
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const open = OPEN_STAGES.reduce((s, k) => s + (by[k] ?? 0), 0);
  return { open, all: rows.reduce((s, r) => s + r.n, 0), ...by };
}

/** Months (yyyy-mm, newest first) that have any orders, for the month picker. */
export async function orderMonths(c: Collections, names: string[] | null): Promise<string[]> {
  const rows = await c.orders.aggregate<{ _id: string }>([
    { $match: scoped({ placedOn: { $ne: null } }, names) },
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
  { key: 'pending', label: STAGE_LABEL.pending },
  { key: 'dc', label: STAGE_LABEL.dc },
  { key: 'transit', label: STAGE_LABEL.transit },
  { key: 'received', label: STAGE_LABEL.received },
  { key: 'variation', label: STAGE_LABEL.variation },
  { key: 'rejected', label: STAGE_LABEL.rejected },
  { key: 'cancelled', label: STAGE_LABEL.cancelled },
] as const;

/** counted = days are counted (Pending, DC Generated, In-Transit, Variation); ack = Acknowledge, the clock stops and the date is shown;
 *  final = Rejected / Cancelled, a final action with a date (or "first seen") and no day count. */
export type CellKind = 'counted' | 'ack' | 'final';
export interface StageCell { since: Date; days: number | null; current: boolean; source: 'portal' | 'observed'; kind: CellKind; outOfOrder?: boolean }

const MAIN_LINE = ['pending', 'dc', 'transit', 'received'] as const;
const SIDE_STAGES = ['variation', 'rejected', 'cancelled'] as const;

/** For each stage column: when the order reached it, how many days it stayed there, and whether it is still there.
 *  Days are counted only for the open stages. Acknowledge stops the clock (date only). Rejected and Cancelled are final (no count).
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
    if (k === 'received') { out[k] = { since, days: null, current: false, source: 'portal', kind: 'ack' }; return; }
    const laterMain = MAIN_LINE.slice(i + 1).map((n) => r[n]).find((d): d is Date => !!d);
    const sideAfter = sideEntries.filter((s) => s.since > since).map((s) => s.since).sort((a, b) => a.getTime() - b.getTime())[0];
    const end = laterMain ?? sideAfter ?? now;
    // The portal's dates do not always follow the stage order (e.g. dispatch dated before the delivery note). A negative length is not shown;
    // the step is marked instead, so the page can say the dates are out of order rather than printing "lasted -7 days".
    const outOfOrder = end.getTime() < since.getTime();
    out[k] = { since, days: outOfOrder ? null : daysBetween(since, end), current: !laterMain && !sideAfter && open.includes(k), source: 'portal', kind: 'counted', ...(outOfOrder ? { outOfOrder: true } : {}) };
  });
  SIDE_STAGES.forEach((k) => {
    const idx = o.stages.findIndex((s) => s.stage === k);
    if (idx < 0) { out[k] = null; return; }
    const entry = o.stages[idx]!;
    if (k !== 'variation') { out[k] = { since: entry.since, days: null, current: o.stage === k, source: entry.source, kind: 'final' }; return; }
    const next = o.stages[idx + 1]?.since ?? now;
    out[k] = { since: entry.since, days: daysBetween(entry.since, next), current: o.stage === k, source: entry.source, kind: 'counted' };
  });
  return out;
}

export const FLAG_TEXT: Record<string, string> = { spike: 'Unusual quantity', typing: 'Same number typed for many items', order: 'Whole order too big', duplicate: 'Possible duplicate' };

/** The month an order belongs to, as the unusual-request flags and issues name it (yyyy-mm, India time). */
export const orderMonth = (placedOn: Date | null | undefined): string => (placedOn ? placedOn.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7) : '');

/** For the orders on screen: open issues and open unusual-request flags for THAT order's hostel AND month, in words. Keyed "hostelCode|yyyy-mm".
 *  (A flag for another month of the same hostel says nothing about this order.) District limits apply. */
export async function hostelIssueTypes(c: Collections, names: string[] | null, pairs: { hostelCode: string; month: string }[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const codes = [...new Set(pairs.map((p) => p.hostelCode))];
  if (!codes.length) return out;
  const wanted = new Set(pairs.map((p) => `${p.hostelCode}|${p.month}`));
  const add = (code: string, month: string, text: string) => { const k = `${code}|${month}`; if (!wanted.has(k)) return; const l = out.get(k) ?? out.set(k, []).get(k)!; if (!l.includes(text)) l.push(text); };
  const [issues, flags] = await Promise.all([
    c.issues.find(scoped({ hostelCode: { $in: codes }, state: { $in: ACTIVE_STATES } }, names), { projection: { hostelCode: 1, state: 1, month: 1 } }).toArray(),
    c.anomalies.find(scoped({ hostelCode: { $in: codes }, status: 'open', severity: { $in: ['high', 'medium'] }, partOfOrder: { $ne: true } }, names), { projection: { hostelCode: 1, kind: 1, month: 1 } }).toArray(),
  ]);
  for (const i of issues) add(i.hostelCode, i.month, i.state === 'rejected_on_portal' ? 'Waiting for new indent' : 'Issue raised');
  for (const f of flags) add(f.hostelCode, f.month, FLAG_TEXT[f.kind] ?? f.kind);
  return out;
}

/** The open unusual-request flags for one hostel and month: the ONE definition used by every screen that counts them
 *  (high and medium only; not the items grouped under a whole-order flag). Keep the list and the detail page on this. */
export const openFlagFilter = (hostelCode: string, month: string) => ({ hostelCode, month, status: 'open' as const, severity: { $in: ['high', 'medium'] as ('high' | 'medium')[] }, partOfOrder: { $ne: true } });
