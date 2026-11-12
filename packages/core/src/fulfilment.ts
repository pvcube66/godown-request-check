import type { AccountDoc, Collections } from './db.js';
import { outOfTime } from './deadline.js';
import type { Stage } from './orders.js';
import { fetchOrderSupplier, fetchRequestItems, PortalAuthError, type OrderSupplier, type PortalRequestItem } from './portalClient.js';

/** How much of an order the godown actually supplied, and how much the hostel received.
 *  Read from the portal's item list (read-only) once an order has a delivery note, and again each time its stage changes.
 *  Quantities are compared item by item (a line against itself), never added across items, because items have different units. */

export interface ShortLine { name: string; unit?: string; packSize?: string; requested: number; supplied: number }

export interface Fulfilment {
  stage: Stage;                      // the order's stage when we read it; re-read when the stage changes
  readAt: Date;
  lines: number;                     // item lines with a requested quantity
  linesWithSupply: number;           // lines the portal gives a supplied quantity for
  fullLines: number;                 // supplied >= requested
  lineFill: number | null;           // average over lines of min(supplied / requested, 1); null if the portal gave no supplied quantities
  receivedFill: number | null;       // average over supplied lines of min(received / supplied, 1); only once the hostel has received
  variationLines: number;            // lines with a non-zero variation quantity
  short: ShortLine[];                // up to 15 lines supplied below the request, biggest shortfall first
}

/** Stages where a supplied quantity means something (a delivery note exists). Pending orders have not been supplied yet, so they are not "short". */
export const SUPPLIED_STAGES: Stage[] = ['dc', 'transit', 'received', 'variation'];
/** Stages from the day the goods leave the godown. Only from here is a supplied quantity compared with the request: at the Delivery-note stage the
 *  portal's supplied quantities may still be being filled in, so a low number there is not a shortfall yet. */
export const DISPATCHED_STAGES: Stage[] = ['transit', 'received', 'variation'];
const RECEIVED_STAGES: Stage[] = ['received', 'variation'];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarizeFulfilment(rows: readonly PortalRequestItem[], stage: Stage, now = new Date()): Fulfilment {
  const lines = rows.filter((r) => r.requestedQuantity > 0);
  const withSupply = lines.filter((r) => r.suppliedQuantity !== undefined);
  const fills = withSupply.map((r) => Math.min((r.suppliedQuantity ?? 0) / r.requestedQuantity, 1));
  const received = RECEIVED_STAGES.includes(stage)
    ? withSupply.filter((r) => (r.suppliedQuantity ?? 0) > 0 && r.receivedQuantity !== undefined).map((r) => Math.min((r.receivedQuantity ?? 0) / r.suppliedQuantity!, 1))
    : [];
  const short = withSupply.filter((r) => (r.suppliedQuantity ?? 0) < r.requestedQuantity)
    .map((r): ShortLine => ({ name: r.name, ...(r.unit ? { unit: r.unit } : {}), ...(r.packSize ? { packSize: r.packSize } : {}), requested: r.requestedQuantity, supplied: r.suppliedQuantity ?? 0 }))
    .sort((a, b) => (b.requested - b.supplied) / b.requested - (a.requested - a.supplied) / a.requested || a.name.localeCompare(b.name))
    .slice(0, 15);
  return {
    stage, readAt: now, lines: lines.length, linesWithSupply: withSupply.length,
    fullLines: withSupply.filter((r) => (r.suppliedQuantity ?? 0) >= r.requestedQuantity).length,
    lineFill: mean(fills), receivedFill: mean(received),
    variationLines: lines.filter((r) => (r.variationQuantity ?? 0) !== 0).length,
    short,
  };
}

export const FULFILMENT_PER_RUN = 120;

/** Reads the item list for orders that have a delivery note and have not been read at their current stage.
 *  At most `limit` per account per run (the first run catches up over a few hours). Authentication errors propagate; others are retried next run. */
export async function syncFulfilment(
  c: Collections, acct: AccountDoc, token: string, limit = FULFILMENT_PER_RUN, pauseMs = 200,
  read: (token: string, requestId: string) => Promise<PortalRequestItem[]> = fetchRequestItems,
): Promise<number> {
  const todo = await c.orders.find({
    account: acct.username, stage: { $in: SUPPLIED_STAGES },
    $or: [{ fulfilment: { $exists: false } }, { $expr: { $ne: ['$fulfilment.stage', '$stage'] } }],
  }, { projection: { requestId: 1, stage: 1 } }).sort({ placedOn: -1 }).limit(limit).toArray();
  let done = 0;
  for (const o of todo) {
    if (outOfTime()) break;
    try {
      const f = summarizeFulfilment(await read(token, o.requestId), o.stage);
      await c.orders.updateOne({ account: acct.username, requestId: o.requestId, stage: o.stage }, { $set: { fulfilment: f } });
      done++;
    } catch (e) {
      if (e instanceof PortalAuthError) throw e;
      console.error(`fulfilment read failed for ${o.requestId}:`, e instanceof Error ? e.message : e);
    }
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return done;
}

/** Reads which supplier each delivered-or-dispatched order belongs to (once per order, a limited number per hour). Read-only. */
export async function syncOrderSuppliers(
  c: Collections, acct: AccountDoc, token: string, limit = FULFILMENT_PER_RUN, pauseMs = 200,
  read: (token: string, requestId: string) => Promise<OrderSupplier | null> = fetchOrderSupplier,
): Promise<number> {
  const todo = await c.orders.find({ account: acct.username, stage: { $in: SUPPLIED_STAGES }, supplier: { $exists: false }, supplierCheckedAt: { $exists: false } } as never, { projection: { requestId: 1 } })
    .sort({ placedOn: -1 }).limit(limit).toArray();
  let done = 0;
  for (const o of todo) {
    if (outOfTime()) break;
    try {
      const sup = await read(token, o.requestId);
      await c.orders.updateOne({ account: acct.username, requestId: o.requestId }, { $set: sup ? { supplier: sup } : { supplierCheckedAt: new Date() } } as never);
      done++;
    } catch (e) {
      if (e instanceof PortalAuthError) throw e;
      console.error(`supplier read failed for ${o.requestId}:`, e instanceof Error ? e.message : e);
    }
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return done;
}
