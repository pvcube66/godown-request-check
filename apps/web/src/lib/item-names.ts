import { normalizedItemName, type Collections } from '@anomaly/core';
import type { ItemNames } from './format';
import { getItemMasters } from './item-master-cache';

/** Readable item names for the keys the detector stores (those are lower-case with the spaces removed, e.g. "cardamomelaichi [unit:kg; pack:kg]").
 *  Built from the item master, which keeps the name the portal uses ("Cardamom (Elaichi)"). */
export async function loadItemNames(c: Pick<Collections, 'itemsMaster'>): Promise<ItemNames> {
  const out: ItemNames = {};
  for (const d of await getItemMasters(c)) {
    if (!d.name) continue;
    out[d.key] ??= d.name;
    out[normalizedItemName(d.name)] ??= d.name;
  }
  return out;
}
