import type { AccountDoc, Collections } from './db.js';
import { getToken } from './accounts.js';
import { fetchGodownOrders, PortalAuthError } from './portalClient.js';

/** Order tracking: where every order is in its life (placed -> DC -> in transit -> received), and since when.
 *  The portal gives day-only dates for most stages and no date at all for cancel/reject, so for those we
 *  record the moment we first saw the status (source 'observed') and never guess. */

export const STAGES = ['pending', 'dc', 'transit', 'received', 'variation', 'rejected', 'cancelled', 'other'] as const;
export type Stage = (typeof STAGES)[number];

/** The stage names exactly as the portal shows them. */
export const STAGE_LABEL: Record<Stage, string> = {
  pending: 'Pending',
  dc: 'DC Generated',
  transit: 'In-Transit',
  received: 'Acknowledge',
  variation: 'Variation',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  other: 'Other',
};

/** Stages where the order is still moving and can get stuck. */
export const OPEN_STAGES: Stage[] = ['pending', 'dc', 'transit', 'variation'];

export interface StageEntry { stage: Stage; since: Date; source: 'portal' | 'observed' }

/** The main line an order follows, in order. Dates are the portal's own; null when not given yet. */
export interface Reached { pending: Date | null; dc: Date | null; transit: Date | null; received: Date | null }

/** Reads the portal's dates for the main line: placed, delivery note made, dispatched (on the way), received. */
export function reachedFromRow(row: Row): Reached {
  return {
    pending: parsePortalDay(row.requested_date) ?? parsePortalDay(row.created_dt),
    dc: parsePortalDay(row.dc_date),
    transit: parsePortalDay(row.supplied_dt),
    received: parsePortalDay(row.received_dt),
  };
}

export interface OrderDoc {
  account: string;                  // portal login the order was fetched with (e.g. GDN-JGL)
  requestId: string;
  hostelCode: string; hostelName: string; districtName: string;
  monthName: string; academicYear: string;
  placedOn: Date | null;
  rawStatus: string; stage: Stage; stageSince: Date;
  stages: StageEntry[];             // history we recorded, oldest first (includes cancel/reject first seen by us)
  /** The portal's own date for each main stage, when it has one. Filled from every sync, so no stage is missed. */
  reached: Reached;
  dcNumber: string | null; vehicleNo: string | null;
  firstSeenAt: Date; lastSeenAt: Date;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? '' : String(v).trim());

const IST_OFFSET_MS = 5.5 * 3_600_000;

/** Calendar day (yyyy-mm-dd) in India time. */
export function istDay(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whole calendar days between two instants, counted in India time. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.parse(`${istDay(from)}T00:00:00Z`);
  const b = Date.parse(`${istDay(to)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Portal day "dd-mm-yyyy" -> midnight India time. Null when empty or unreadable. */
export function parsePortalDay(s: unknown): Date | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(str(s));
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00+05:30`) : null;
}

/** Portal status text -> our stage. The portal spells "In_Trasit" with a typo; keep matching it. */
export function stageOf(raw: string): Stage {
  switch (raw.trim().toLowerCase()) {
    case 'pending': return 'pending';
    case 'dc_generated': return 'dc';
    case 'in_trasit': case 'in_transit': case 'in-transit': return 'transit';
    case 'acknowledged': return 'received';
    case 'variation': return 'variation';
    case 'rejected': return 'rejected';
    case 'cancelled': case 'canceled': return 'cancelled';
    default: return 'other';
  }
}

/** The date the portal itself gives for when an order reached a stage, or null when it gives none. */
export function portalSince(row: Row, stage: Stage): Date | null {
  const d = (k: string) => parsePortalDay(row[k]);
  switch (stage) {
    case 'pending': return d('requested_date') ?? d('created_dt');
    case 'dc': return d('dc_date') ?? d('supplied_dt');
    case 'transit': return d('supplied_dt') ?? d('dc_date');
    case 'received': case 'variation': return d('received_dt') ?? d('supplied_dt');
    default: return null;                                   // cancelled / rejected: the portal keeps no date
  }
}

/** Academic year for a calendar month, e.g. Sep 2026 -> "2026-27", Feb 2027 -> "2026-27". */
export function academicYearFor(year: number, month1: number): string {
  const start = month1 >= 6 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** Every month of the academic year we are in (June to May), fetched on each pass.
 *  Older orders can stay stuck for months (e.g. September requests still Pending in November), so a short window would miss them. */
export function academicYearWindows(now = new Date()): { monthName: string; academicYear: string }[] {
  const startYear = now.getUTCMonth() + 1 >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const academicYear = academicYearFor(startYear, 6);
  return Array.from({ length: 12 }, (_, i) => ({ monthName: MONTH_NAMES[(5 + i) % 12]!, academicYear }));   // June ... May
}

export interface OrderPatch {
  header: Omit<OrderDoc, 'account' | 'requestId' | 'stages' | 'firstSeenAt'>;   // includes `reached`
  entry: StageEntry;
  stageChanged: boolean;
}

/** Turns one portal row into the fields we store, and says whether the stage moved since last time. */
export function orderPatch(row: Row, prev: Pick<OrderDoc, 'stage'> | undefined, now: Date): OrderPatch {
  const stage = stageOf(str(row.status));
  const portal = portalSince(row, stage);
  const since = portal ?? now;
  return {
    header: {
      hostelCode: str(row.hostel_id),
      hostelName: str(row.hostel_name),
      districtName: str(row.district),
      monthName: str(row.month_name),
      academicYear: str(row.academic_year),
      placedOn: parsePortalDay(row.requested_date) ?? parsePortalDay(row.created_dt),
      reached: reachedFromRow(row),
      rawStatus: str(row.status),
      stage,
      stageSince: since,
      dcNumber: str(row.dc_number) || null,
      vehicleNo: str(row.vehicle_regno) || null,
      lastSeenAt: now,
    },
    entry: { stage, since, source: portal ? 'portal' : 'observed' },
    stageChanged: !prev || prev.stage !== stage,
  };
}

/** Days the order has been in its current stage, as of now (India calendar days). */
export function daysInStage(o: Pick<OrderDoc, 'stageSince'>, now = new Date()): number {
  return daysBetween(o.stageSince, now);
}

/** Pulls every order for the recent months plus any month that still has an open order, and records changes. */
export async function syncOrders(c: Collections, acct: AccountDoc, token: string, now = new Date()): Promise<number> {
  const windows = new Map<string, { monthName: string; academicYear: string }>();
  for (const w of academicYearWindows(now)) windows.set(`${w.academicYear}|${w.monthName}`, w);
  const open = await c.orders.find({ account: acct.username, stage: { $in: OPEN_STAGES } }, { projection: { monthName: 1, academicYear: 1 } }).toArray();
  for (const o of open) windows.set(`${o.academicYear}|${o.monthName}`, { monthName: o.monthName, academicYear: o.academicYear });

  let current = token;
  let total = 0;
  for (const w of windows.values()) {
    let rows: Row[];
    try {
      rows = await fetchGodownOrders(current, acct.username, w.monthName, w.academicYear);
    } catch (e) {
      if (!(e instanceof PortalAuthError)) throw e;
      current = await getToken(c, acct, true);
      rows = await fetchGodownOrders(current, acct.username, w.monthName, w.academicYear);
    }
    if (rows.length === 0) continue;
    const ids = rows.map((r) => str(r.request_id));
    const prevs = new Map((await c.orders.find({ account: acct.username, requestId: { $in: ids } }).toArray())
      .map((o) => [o.requestId, o]));
    const ops = rows.map((row) => {
      const requestId = str(row.request_id);
      const prev = prevs.get(requestId);
      const p = orderPatch(row, prev, now);
      const filter = { account: acct.username, requestId };
      if (!prev) {
        return { updateOne: { filter, update: { $set: { ...p.header }, $setOnInsert: { firstSeenAt: now, stages: [p.entry] } }, upsert: true } };
      }
      if (p.stageChanged) {
        return { updateOne: { filter, update: { $set: p.header, $push: { stages: p.entry } } } };
      }
      const { stage: _s, stageSince: _d, ...keep } = p.header;
      void _s; void _d;
      return { updateOne: { filter, update: { $set: keep } } };
    });
    if (ops.length) await c.orders.bulkWrite(ops);
    total += rows.length;
  }
  return total;
}
