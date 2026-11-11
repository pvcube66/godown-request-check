import { effectiveItemMetadata, fetchRequestItems, getToken, itemVariantKey, normalizedItemName, requestItemSnapshots, snapshotsComplete, syncItemMasters, type AccountDoc, type Collections, type RequestItemSnapshot } from '@anomaly/core';

export interface IndentRow { name: string; quantity: number; unit: string; packSize: string }
const MISSING = '—';
const ITEM_READ_ATTEMPTS = 5;

/** Fills in the units of a request from the portal's own item list, and saves them. Read-only towards the portal. Never throws. */
async function readUnitsFromPortal(c: Collections, requestId: string): Promise<boolean> {
  try {
    const request = await c.requests.findOne({ requestId }, { projection: { godownId: 1, items: 1, status: 1 } });
    if (!request) return false;
    const acct = (await c.accounts.find({ status: { $ne: 'disabled' } }, { projection: { username: 1, godowns: 1, tokenEnc: 1, tokenExpiresAt: 1, passwordEnc: 1, status: 1 } }).toArray())
      .find((a) => a.godowns.some((g) => g.id === request.godownId)) as AccountDoc | undefined;
    if (!acct) return false;
    const token = await getToken(c, acct);
    const rows = await fetchRequestItems(token, requestId);
    const items = rows.map(({ remarks, supplierRemarks, vendorRemarks, ...item }) => item);
    const snapshots = requestItemSnapshots(request.items ?? {}, items);
    await syncItemMasters(c, items);
    await c.requests.updateOne({ requestId }, { $set: { itemSnapshots: snapshots, itemMetadataSyncedAt: new Date(), itemSnapshotsIncomplete: rows.length > 0 && !snapshotsComplete(snapshots) }, $inc: { itemReadAttempts: 1 } });
    return true;
  } catch {
    return false;
  }
}

/** The full item list of one request with its unit and pack size. If the unit is not stored yet, it is read from the portal right away. */
export async function loadIndent(c: Collections, requestId: string): Promise<IndentRow[]> {
  let request = await c.requests.findOne({ requestId });
  if (!request) return [];
  // Read the portal only when a unit is genuinely missing, and at most ITEM_READ_ATTEMPTS times in total (after that the portal has nothing to give).
  const missing = !request.itemSnapshots || request.itemSnapshots.some((s) => !(s.unit ?? '').trim() && !(s.packSize ?? '').trim());
  if (missing && (request.itemReadAttempts ?? 0) < ITEM_READ_ATTEMPTS && await readUnitsFromPortal(c, requestId)) request = (await c.requests.findOne({ requestId })) ?? request;
  const snapshots: RequestItemSnapshot[] = request.itemSnapshots ?? [];
  const masters = snapshots.length ? await c.itemsMaster.find({ key: { $in: snapshots.map(itemVariantKey) } }).toArray() : [];
  return Object.entries(request.items ?? {}).filter(([, q]) => q > 0).map(([name, quantity]) => {
    const snapshot = snapshots.find((s) => s.sourceKey === name);
    const master = snapshot ? masters.find((m) => m.key === itemVariantKey(snapshot)) : undefined;
    const meta = master ? effectiveItemMetadata(master) : snapshot;
    return { name, quantity, unit: meta?.unit?.trim() || MISSING, packSize: meta?.packSize?.trim() || MISSING };
  });
}

/** Which item a flag is about, in the same form as an indent row's normalized name. */
export const flaggedItemName = (anomalyItem: string): string => anomalyItem.includes(' [unit:') ? anomalyItem.split(' [unit:')[0]! : normalizedItemName(anomalyItem);
export const isFlaggedRow = (row: IndentRow, flagged: ReadonlySet<string>) => flagged.has(normalizedItemName(row.name));
