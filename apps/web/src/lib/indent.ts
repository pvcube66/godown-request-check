import { effectiveItemMetadata, fetchRequestItems, getToken, itemVariantKey, normalizedItemName, requestItemSnapshots, snapshotsComplete, syncItemMasters, type AccountDoc, type Collections, type PortalRequestItem, type RequestItemSnapshot } from '@anomaly/core';

export interface IndentRow { name: string; quantity: number; unit: string; packSize: string }
const MISSING = '—';

/** The portal's own item list for one request, read now. Null when the portal could not be reached (the stored copy is used then). */
async function portalItemsNow(c: Collections, requestId: string, godownId: number | undefined, account: string | undefined): Promise<PortalRequestItem[] | null> {
  try {
    const accounts = await c.accounts.find({ status: { $ne: 'disabled' } }, { projection: { username: 1, godowns: 1, tokenEnc: 1, tokenExpiresAt: 1, passwordEnc: 1, status: 1 } }).toArray();
    const acct = (accounts.find((a) => (account && a.username === account)) ?? accounts.find((a) => godownId !== undefined && a.godowns.some((g) => g.id === godownId))) as AccountDoc | undefined;
    if (!acct) return null;
    return await fetchRequestItems(await getToken(c, acct), requestId);
  } catch {
    return null;
  }
}

/** The indent's items, read from the portal whenever the page is opened (the hourly sync is only a backup). Keeps what it reads. */
/** `live` (default) asks the portal now. Lists that show many indents pass live: false and use the copy kept from the hourly sync. */
export async function loadIndent(c: Collections, requestId: string, { live = true }: { live?: boolean } = {}): Promise<IndentRow[]> {
  const [request, order] = await Promise.all([
    c.requests.findOne({ requestId }),
    c.orders.findOne({ requestId }, { projection: { account: 1 } }),
  ]);
  if (!request && !order) return [];
  const portal = live ? await portalItemsNow(c, requestId, request?.godownId, order?.account) : null;
  const stored = request?.items ?? {};
  const names = portal && portal.length
    ? portal.map((r) => ({ name: r.name, quantity: r.requestedQuantity, portal: r }))
    : Object.entries(stored).filter(([, q]) => q > 0).map(([name, quantity]) => ({ name, quantity, portal: undefined as PortalRequestItem | undefined }));
  if (!names.length) return [];

  // Keep what was read, so the stored copy is complete next time too.
  if (portal && portal.length && request) {
    const items = portal.map(({ remarks, supplierRemarks, vendorRemarks, ...item }) => item);
    const snapshots = requestItemSnapshots(Object.keys(stored).length ? stored : Object.fromEntries(portal.map((r) => [r.name, r.requestedQuantity])), items);
    await syncItemMasters(c, items).catch(() => undefined);
    await c.requests.updateOne({ requestId }, { $set: { itemSnapshots: snapshots, itemMetadataSyncedAt: new Date(), itemSnapshotsIncomplete: !snapshotsComplete(snapshots) } });
  }

  const snapshots: RequestItemSnapshot[] = request?.itemSnapshots ?? [];
  const masters = snapshots.length ? await c.itemsMaster.find({ key: { $in: snapshots.map(itemVariantKey) } }).toArray() : [];
  const rows = names.map(({ name, quantity, portal: row }) => {
    const snapshot = snapshots.find((s) => s.sourceKey === name);
    const master = snapshot ? masters.find((m) => m.key === itemVariantKey(snapshot)) : undefined;
    const meta = master ? effectiveItemMetadata(master) : snapshot;
    return { name, quantity, unit: (row?.unit ?? meta?.unit ?? '').trim(), packSize: (row?.packSize ?? meta?.packSize ?? '').trim() };
  });
  // Items with no unit on record here: take the unit this same item has on other orders, but only when every unit seen agrees.
  const catalogueUnit = await unitsByName(c, [...new Set(rows.filter((r) => !r.unit).map((r) => normalizedItemName(r.name)))]);
  return rows.map((r) => ({ name: r.name, quantity: r.quantity, unit: r.unit || catalogueUnit.get(normalizedItemName(r.name)) || MISSING, packSize: r.packSize || MISSING }));
}

/** For each item name: the one unit seen for it across the catalogue, when all observed variants agree. */
export async function unitsByName(c: Collections, names: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const n of names) {
    if (!n) continue;
    const found = await c.itemsMaster.find({ key: { $regex: `^${n}( \\[unit:)` } }, { projection: { unit: 1, override: 1 } }).limit(50).toArray();
    const units = new Set(found.map((f) => (f.override?.unit ?? f.unit ?? '').trim()).filter(Boolean));
    if (units.size === 1) out.set(n, [...units][0]!);
  }
  return out;
}

/** Which item a flag is about, in the same form as an indent row's normalized name. */
export const flaggedItemName = (anomalyItem: string): string => anomalyItem.includes(' [unit:') ? anomalyItem.split(' [unit:')[0]! : normalizedItemName(anomalyItem);
export const isFlaggedRow = (row: IndentRow, flagged: ReadonlySet<string>) => flagged.has(normalizedItemName(row.name));
