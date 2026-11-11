import { describe, expect, it } from 'vitest';
import { runDetection, stableItemName, DEFAULT_CONFIG } from './detector.js';
import { itemVariantKey } from './itemMaster.js';
import type { Collections } from './db.js';

/** A small in-memory stand-in for the few collections runDetection touches. Only the query shapes it uses are supported. */
function memory(reqs: Record<string, unknown>[], anomalies: Record<string, unknown>[], issues: Record<string, unknown>[] = []) {
  const match = (d: Record<string, unknown>, f: Record<string, unknown>): boolean => Object.entries(f).every(([k, v]) => {
    if (k === '$or') return (v as Record<string, unknown>[]).some((x) => match(d, x));
    const x = d[k];
    if (Array.isArray(x) && !(v && typeof v === 'object')) return x.includes(v);      // Mongo matches an array element
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      const o = v as Record<string, unknown>;
      if ('$in' in o) return (o.$in as unknown[]).includes(x);
      if ('$nin' in o) return !(o.$nin as unknown[]).includes(x);
      if ('$ne' in o) return x !== o.$ne;
      if ('$exists' in o) return (x !== undefined) === o.$exists;
    }
    return x === v;
  });
  const cursor = (rows: Record<string, unknown>[]) => ({ sort: () => cursor(rows), limit: () => cursor(rows), toArray: async () => rows });
  const apply = (d: Record<string, unknown>, u: Record<string, Record<string, unknown>>) => { Object.assign(d, u.$set ?? {}); };
  const c = {
    settings: { findOne: async () => null },
    requests: { find: () => cursor(reqs) },
    hostels: { find: () => cursor([]) },
    anomalies: {
      distinct: async (field: string) => [...new Set(anomalies.filter((a) => a.status === 'open').map((a) => a[field]))],
      find: (f: Record<string, unknown>) => cursor(anomalies.filter((a) => match(a, f))),
      updateOne: async (f: Record<string, unknown>, u: Record<string, Record<string, unknown>>, o?: { upsert?: boolean }) => {
        const d = anomalies.find((a) => match(a, f));
        if (d) { apply(d, u); return { upsertedCount: 0 }; }
        if (o?.upsert) { const n: Record<string, unknown> = { ...f, ...(u.$setOnInsert ?? {}) }; apply(n, u); anomalies.push(n); return { upsertedCount: 1 }; }
        return { upsertedCount: 0 };
      },
      updateMany: async (f: Record<string, unknown>, u: Record<string, Record<string, unknown>>) => { for (const a of anomalies) if (match(a, f)) apply(a, u); },
    },
    issues: {
      updateMany: async (f: Record<string, unknown>, u: Record<string, Record<string, unknown>>) => {
        for (const i of issues) if (match(i, f)) {
          const keys = (i.anomalyKeys as string[]) ?? [];
          if (u.$pull) { const drop = (u.$pull.anomalyKeys as unknown) as string; i.anomalyKeys = keys.filter((k) => k !== drop); }
          if (u.$addToSet) { const add = (u.$addToSet.anomalyKeys as unknown) as string; if (!keys.includes(add)) i.anomalyKeys = [...keys, add]; }
        }
      },
    },
  } as unknown as Collections;
  return { c, anomalies, issues };
}

const COMMON = { A: 100, B: 50, C: 20, D: 80, E: 40, F: 60 };
const peers = (month: string, item: string) => Array.from({ length: 14 }, (_, i) => ({ godownId: 2, hostelCode: `Q${i}`, hostelName: `Q${i}`, districtName: 'D', month, status: 'Pending', items: { ...COMMON, [item]: 10 + (i % 3) } }));
const hostel = (month: string, item: string, qty: number, extra: Record<string, unknown> = {}) => ({ godownId: 2, hostelCode: 'H', hostelName: 'H-X', districtName: 'D', month, status: 'Pending', items: { ...COMMON, [item]: qty }, requestId: `R-${month}`, requestDate: `${month}-02`, ...extra });

describe('flags keep their identity when an item gets its unit', () => {
  it('a plain item name and the same item with its unit give one flag key', () => {
    expect(stableItemName('Chicken Masala Powder')).toBe(stableItemName(itemVariantKey({ name: 'Chicken Masala Powder', unit: 'Kg' })));
  });

  it('a review decision made on the old flag moves to the new key, and issues follow it', async () => {
    const month = '2026-10', raw = 'Rice';
    const reqs = [...peers(month, raw), hostel(month, raw, 300)];
    const oldKey = `2|H|${month}|${raw}`;
    const { c, anomalies, issues } = memory(reqs, [{ key: oldKey, godownId: 2, hostelCode: 'H', month, item: raw, kind: 'spike', status: 'confirmed', hostelName: 'H-X', districtName: 'D' }],
      [{ issueId: 'I1', anomalyKeys: [oldKey], state: 'raised' }]);
    // the request is now read with its unit: the item name changes form
    const withUnit = reqs.map((r) => ({ ...r, itemSnapshots: Object.entries(r.items).map(([k, q]) => ({ sourceKey: k, name: k, unit: 'Kg', requestedQuantity: q })) }));
    (c as unknown as { requests: { find: () => unknown } }).requests.find = () => ({ sort: () => ({ limit: () => ({ toArray: async () => withUnit }) }), limit: () => ({ toArray: async () => withUnit }), toArray: async () => withUnit });
    await runDetection(c, [month]);
    const oldDoc = anomalies.find((a) => a.key === oldKey)!;
    const newDoc = anomalies.find((a) => a.key !== oldKey && a.hostelCode === 'H' && a.kind === 'spike')!;
    expect(newDoc).toBeDefined();
    expect(newDoc.status).toBe('confirmed');
    expect(oldDoc.status).toBe('resolved');
    expect(oldDoc.supersededBy).toBe(newDoc.key);
    expect(issues[0]!.anomalyKeys).toEqual([newDoc.key]);
  });

  it('keeps the same flag when nothing changed (no migration, no duplicate)', async () => {
    const month = '2026-10';
    const reqs = [...peers(month, 'Rice'), hostel(month, 'Rice', 300)];
    const { c, anomalies } = memory(reqs, []);
    await runDetection(c, [month]);
    const before = anomalies.length;
    await runDetection(c, [month]);
    expect(anomalies.length).toBe(before);
    expect(DEFAULT_CONFIG.dropMinor).toBe(true);
  });
});


