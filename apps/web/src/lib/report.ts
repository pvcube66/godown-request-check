import type { AnomalyDoc, Collections } from '@anomaly/core';

export interface ReportParams { month?: string; district?: string; q?: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Items that need attention (high + medium, still open) for the given filters, biggest jump first. */
export async function loadReport(c: Collections, p: ReportParams): Promise<AnomalyDoc[]> {
  const filter: Record<string, unknown> = { status: 'open', severity: { $in: ['high', 'medium'] }, partOfOrder: { $ne: true } };
  if (p.month) filter.month = p.month;
  if (p.district) filter.districtName = p.district;
  const q = (p.q ?? '').trim().slice(0, 60);
  if (q) filter.hostelName = { $regex: escapeRe(q), $options: 'i' };
  return c.anomalies.find(filter as never).sort({ ratio: -1 }).limit(5000).toArray();
}
