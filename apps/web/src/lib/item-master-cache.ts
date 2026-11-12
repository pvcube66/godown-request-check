import type { Collections, ItemMasterDoc } from '@anomaly/core';

/** The item master (names and units) is read by almost every page but changes rarely, so one copy is kept in memory for a short time.
 *  A correction made on the Master page clears it at once on that server; other servers pick it up within TTL_MS. */
const TTL_MS = 60_000;
let cached: { at: number; docs: Promise<ItemMasterDoc[]> } | null = null;

export function getItemMasters(c: Pick<Collections, 'itemsMaster'>): Promise<ItemMasterDoc[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.docs;
  const docs = c.itemsMaster.find({}).toArray();
  cached = { at: Date.now(), docs };
  docs.catch(() => { if (cached?.docs === docs) cached = null; });      // never keep a failed read
  return docs;
}

export const clearItemMasterCache = () => { cached = null; };
