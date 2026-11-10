import { effectiveItemMetadata, itemVariantKey, normalizedItemName, type Collections } from '@anomaly/core';

export interface IndentRow { name: string; quantity: number; unit: string; packSize: string }

/** The full item list of one request with its unit and pack size (from the item master, corrected values first). */
export async function loadIndent(c: Collections, requestId: string): Promise<IndentRow[]> {
  const request = await c.requests.findOne({ requestId });
  if (!request) return [];
  const snapshots = request.itemSnapshots ?? [];
  const masters = snapshots.length ? await c.itemsMaster.find({ key: { $in: snapshots.map(itemVariantKey) } }).toArray() : [];
  return Object.entries(request.items ?? {}).filter(([, q]) => q > 0).map(([name, quantity]) => {
    const snapshot = snapshots.find((s) => s.sourceKey === name);
    const master = snapshot ? masters.find((m) => m.key === itemVariantKey(snapshot)) : undefined;
    const meta = master ? effectiveItemMetadata(master) : snapshot;
    return { name, quantity, unit: meta?.unit || 'Unknown', packSize: meta?.packSize || 'Unknown' };
  });
}

/** Which item a flag is about, in the same form as an indent row's normalized name. */
export const flaggedItemName = (anomalyItem: string): string => anomalyItem.includes(' [unit:') ? anomalyItem.split(' [unit:')[0]! : normalizedItemName(anomalyItem);
export const isFlaggedRow = (row: IndentRow, flagged: ReadonlySet<string>) => flagged.has(normalizedItemName(row.name));
