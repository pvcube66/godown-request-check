import type { Collections } from './db.js';
import { DEFAULT_CONFIG, detectAnomalies, type DetectorConfig } from './detector.js';

export interface CancellationResult {
  requestId: string; hostelName: string; month: string; total: number; items: number; reason: string | null;
  flagged: boolean; flags: number; mediumHigh: number; kinds: string[];
}

const CACHE_ID = 'cancellationCheck';

/** The check is a full re-run of the detector, so it is computed once an hour with the other checks and read from the database
 *  by the Accuracy page. If nothing is stored yet (or it is old), it is computed now and stored. */
export async function getCancellationCheck(c: Collections, maxAgeMs = 6 * 3_600_000): Promise<CancellationResult[]> {
  const saved = await c.settings.findOne({ _id: CACHE_ID });
  const v = saved?.value as { computedAt?: string; results?: CancellationResult[] } | undefined;
  if (v?.results && v.computedAt && Date.now() - new Date(v.computedAt).getTime() < maxAgeMs) return v.results;
  return refreshCancellationCheck(c);
}

export async function refreshCancellationCheck(c: Collections, cfg: DetectorConfig = DEFAULT_CONFIG): Promise<CancellationResult[]> {
  const results = await cancellationCheck(c, cfg);
  await c.settings.updateOne({ _id: CACHE_ID }, { $set: { value: { computedAt: new Date().toISOString(), results } } }, { upsert: true });
  return results;
}

/** The portal's own cancelled requests are real, human-labelled mistakes. This re-runs the detector as if each one were still live
 *  (before anyone cancelled it) and reports whether it would have been flagged. */
export async function cancellationCheck(c: Collections, cfg: DetectorConfig = DEFAULT_CONFIG): Promise<CancellationResult[]> {
  const all = await c.requests.find({}).toArray();
  const sizes = new Map((await c.hostels.find({ students: { $gt: 0 } }).toArray()).map((h) => [`${h.godownId}|${h.hostelCode}`, h.students!] as const));
  const cancelled = all.filter((r) => /^reject/i.test(r.status));
  if (!cancelled.length) return [];
  const live = all.map((r) => (/^reject/i.test(r.status) ? { ...r, status: 'Pending' } : r));
  const found = detectAnomalies(live, [...new Set(cancelled.map((r) => r.month))], cfg, sizes);
  return cancelled.map((r) => {
    const f = found.filter((a) => a.hostelCode === r.hostelCode && a.month === r.month && (a.kind === 'order' || a.kind === 'duplicate' || (r.items[a.item] ?? 0) > 0));
    return {
      requestId: r.requestId, hostelName: r.hostelName, month: r.month,
      total: Object.values(r.items).reduce((s, q) => s + q, 0), items: Object.values(r.items).filter((q) => q > 0).length,
      reason: r.cancelReason ?? null, flagged: f.length > 0, flags: f.length, mediumHigh: f.filter((a) => a.severity !== 'low').length,
      kinds: [...new Set(f.map((a) => a.kind))],
    };
  }).sort((a, b) => b.total - a.total);
}
