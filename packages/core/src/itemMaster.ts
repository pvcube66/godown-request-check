import type { Collection } from 'mongodb';
import type { AuditDoc } from './masterData.js';

export interface ItemMetadata {
  unit?: string;
  packSize?: string;
  brand?: string;
  category?: string;
}

/** Source quantities are retained without converting between units or pack sizes. */
export interface RequestItemSnapshot extends ItemMetadata {
  sourceKey: string;
  itemId?: string;
  name: string;
  requestedQuantity: number;
  suppliedQuantity?: number;
  receivedQuantity?: number;
  variationQuantity?: number;
  finalQuantity?: number;
}

/** Observed identity is immutable; corrections live separately from portal observations. */
export interface ItemMasterDoc extends ItemMetadata {
  key: string;
  name: string;
  itemId?: string;
  createdAt: Date;
  lastSeenAt: Date;
  override?: ItemMetadata;
  overrideBy?: string;
  overrideAt?: Date;
}
export interface ItemMasterCollections {
  itemsMaster: Collection<ItemMasterDoc>;
  auditLog?: Collection<AuditDoc>;
}

export const normalizedItemName = (name: string): string => name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
const dimension = (value?: string): string => (value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** No unit aliases or weight conversions: even plausible aliases can hide different variants. */
export function itemVariantKey(item: Pick<RequestItemSnapshot, 'name' | 'unit' | 'packSize'>): string {
  return `${normalizedItemName(item.name)} [unit:${encodeURIComponent(dimension(item.unit)) || 'unknown'}; pack:${encodeURIComponent(dimension(item.packSize)) || 'unknown'}]`;
}

export function quantityLabel(snapshot: ItemMetadata): string {
  return [snapshot.unit?.trim(), snapshot.packSize?.trim()].filter(Boolean).join(' / ') || 'unit unknown';
}

export function effectiveItemMetadata(item: ItemMetadata & { override?: ItemMetadata }): ItemMetadata {
  return {
    ...Object.fromEntries(['unit', 'packSize', 'brand', 'category'].flatMap((key) => {
      const value = item[key as keyof ItemMetadata];
      return value === undefined ? [] : [[key, value]];
    })),
    ...item.override,
  };
}

/** Match only a unique report key to a unique portal row. Never allocate an aggregate to multiple variants. */
export function requestItemSnapshots(
  items: Record<string, number>, rows: readonly Omit<RequestItemSnapshot, 'sourceKey'>[],
): RequestItemSnapshot[] {
  const reportCounts = new Map<string, number>();
  const byName = new Map<string, Omit<RequestItemSnapshot, 'sourceKey'>[]>();
  for (const key of Object.keys(items)) {
    const name = normalizedItemName(key);
    reportCounts.set(name, (reportCounts.get(name) ?? 0) + 1);
  }
  for (const row of rows) {
    const name = normalizedItemName(row.name);
    byName.set(name, [...(byName.get(name) ?? []), row]);
  }
  return Object.entries(items).map(([sourceKey, quantity]) => {
    const name = normalizedItemName(sourceKey), matches = byName.get(name);
    const match = name && reportCounts.get(name) === 1 && matches?.length === 1 ? matches[0] : undefined;
    return match ? { ...match, sourceKey } : { sourceKey, name: sourceKey, requestedQuantity: quantity };
  });
}

/** Legacy/unknown items keep their raw key; known variants cannot borrow legacy history.
 * Detection always uses report quantities, not supplied/received/final quantities or a converted weight. */
export function comparisonItems(request: { items: Record<string, number>; itemSnapshots?: readonly RequestItemSnapshot[] }): Record<string, number> {
  if (!request.itemSnapshots) return { ...request.items };
  const result: Record<string, number> = {};
  for (const [sourceKey, quantity] of Object.entries(request.items)) {
    const matches: RequestItemSnapshot[] = request.itemSnapshots.filter((s) => s.sourceKey === sourceKey);
    const snapshot: RequestItemSnapshot | undefined = matches.length === 1 ? matches[0] : undefined;
    const key: string = snapshot && (dimension(snapshot.unit) || dimension(snapshot.packSize)) ? itemVariantKey(snapshot) : sourceKey;
    result[key] = (result[key] ?? 0) + quantity;
  }
  return result;
}

export async function syncItemMasters(
  c: ItemMasterCollections, observations: readonly (ItemMetadata & { name: string; itemId?: string })[],
): Promise<void> {
  const now = new Date();
  const variants = new Map(observations.filter((s) => normalizedItemName(s.name)).map((s) => [itemVariantKey(s), s]));
  if (!variants.size) return;
  await c.itemsMaster.bulkWrite([...variants].map(([key, s]) => ({ updateOne: {
    filter: { key },
    update: {
      $set: { lastSeenAt: now },
      $setOnInsert: { key, name: s.name, ...(s.itemId !== undefined ? { itemId: s.itemId } : {}), ...effectiveItemMetadata(s), createdAt: now },
    },
    upsert: true,
  } })));
}

export async function updateItemMaster(c: ItemMasterCollections, key: string, patch: ItemMetadata, actor: string): Promise<void> {
  if (!actor.trim()) throw new Error('Actor is required');
  const fields: Record<string, string | Date> = { overrideBy: actor, overrideAt: new Date() };
  for (const field of ['unit', 'packSize', 'brand', 'category'] as const) {
    if (patch[field] !== undefined) {
      if (typeof patch[field] !== 'string') throw new Error(`Invalid ${field}`);
      fields[`override.${field}`] = patch[field]!.trim();
    }
  }
  if (Object.keys(fields).length === 2) throw new Error('An item metadata correction is required');
  const result = await c.itemsMaster.updateOne({ key }, { $set: fields });
  if (result.matchedCount !== 1) throw new Error(`Unknown item variant ${key}`);
  if (c.auditLog) await c.auditLog.insertOne({ actor, action: 'item.update', target: key, at: new Date(), details: { patch } });
}
