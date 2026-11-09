import type { Collections } from '@anomaly/core';

/** hostel key -> item -> month -> total quantity (rejected requests ignored) */
export type History = Record<string, Record<string, Record<string, number>>>;
export const hostelKey = (godownId: number, hostelCode: string) => `${godownId}|${hostelCode}`;

export async function loadHistory(c: Collections, pairs: { godownId: number; hostelCode: string }[], knownMonths?: string[]) {
  const months = knownMonths ?? (await c.requests.distinct('month')).sort();
  const history: History = {};
  if (!pairs.length) return { history, months };
  const wanted = new Set(pairs.map((p) => hostelKey(p.godownId, p.hostelCode)));
  const reqs = await c.requests.find(
    { hostelCode: { $in: [...new Set(pairs.map((p) => p.hostelCode))] } },
    { projection: { godownId: 1, hostelCode: 1, month: 1, status: 1, items: 1 } },
  ).toArray();
  for (const r of reqs) {
    const k = hostelKey(r.godownId, r.hostelCode);
    if (!wanted.has(k) || /^reject/i.test(r.status)) continue;
    const h = (history[k] ??= {});
    for (const [it, q] of Object.entries(r.items)) { const row = (h[it] ??= {}); row[r.month] = (row[r.month] ?? 0) + q; }
  }
  return { history, months };
}

/** Months that this hostel has any request in (used for the "only N months so far" note). */
export function monthsWithRequests(h: History[string] | undefined): Set<string> {
  const s = new Set<string>();
  for (const row of Object.values(h ?? {})) for (const m of Object.keys(row)) s.add(m);
  return s;
}

/** Items that belong to a whole-order finding, keyed by "godownId|hostel|month". */
export async function loadOrderItems(c: Collections, orders: { godownId: number; hostelCode: string; month: string }[]) {
  const map = new Map<string, import('@anomaly/core').AnomalyDoc[]>();
  if (!orders.length) return map;
  const rows = await c.anomalies.find({ partOfOrder: true, status: 'open', $or: orders.map((o) => ({ godownId: o.godownId, hostelCode: o.hostelCode, month: o.month })) }).sort({ ratio: -1 }).toArray();
  for (const r of rows) { const k = `${r.godownId}|${r.hostelCode}|${r.month}`; (map.get(k) ?? map.set(k, []).get(k)!).push(r); }
  return map;
}
