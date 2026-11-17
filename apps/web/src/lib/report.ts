import { scoped, type AnomalyDoc, type Collections } from '@anomaly/core';
import { hostelLabel, IMPORTANCE, itemLabel, METHOD_TEXT, monthLabel, timesMore, type ItemNames } from './format';
import { unitFor } from './units';

/** sev/kind/view/godown are the Unusual Requests screen's own choices. Left out, the list is the classic one: open, high and medium. */
export interface ReportParams { month?: string; district?: string; q?: string; sev?: string; kind?: string; view?: string; godown?: string }
export const REPORT_KINDS = ['spike', 'typing', 'order', 'duplicate'] as const;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Items that need attention (high + medium, still open) for the given filters, biggest jump first. */
export async function loadReport(c: Collections, p: ReportParams, names: string[] | null): Promise<AnomalyDoc[]> {
  const filter: Record<string, unknown> = { status: 'open', severity: { $in: ['high', 'medium'] }, partOfOrder: { $ne: true } };
  if (p.sev !== undefined) filter.severity = p.sev === 'all' ? { $in: ['high', 'medium', 'low'] } : (['high', 'medium', 'low'].includes(p.sev) ? p.sev : 'high');
  if (p.view === 'confirmed') filter.status = 'confirmed'; else if (p.view === 'fine') filter.status = { $in: ['ignored', 'expected'] };
  if ((REPORT_KINDS as readonly string[]).includes(p.kind ?? '')) filter.kind = p.kind;
  if (/^\d{1,9}$/.test(p.godown ?? '')) filter.godownId = Number(p.godown);
  if (p.month) filter.month = p.month;
  if (p.district) filter.districtName = p.district;
  const q = (p.q ?? '').trim().slice(0, 60);
  if (q) filter.hostelName = { $regex: escapeRe(q), $options: 'i' };
  return c.anomalies.find(scoped(filter, names) as never).sort({ ratio: -1 }).limit(5000).toArray();
}

export const REPORT_HEAD = ['S.No', 'Hostel ID', 'Hostel', 'District', 'Month', 'Item', 'Unit', 'Asked for', 'Usually about', 'How much more', 'How important', 'How we compared'];

/** The rows of the Unusual Requests download (shared by the CSV and the Excel file). */
export function reportRows(rows: AnomalyDoc[], itemNames: ItemNames, units: Parameters<typeof unitFor>[1]): (string | number)[][] {
  return rows.map((a, i) => [
    i + 1, a.hostelCode,
    ...(a.kind === 'duplicate'
      ? [hostelLabel(a.hostelName), a.districtName, monthLabel(a.month), `Possible duplicate: ${a.dup?.requestIds.join(' and ')}`, '', '', '', `${Math.round((a.dup?.similarity ?? 0) * 100)}% the same`, IMPORTANCE[a.severity], `Two requests that match across ${a.dup?.items} items`]
      : a.kind === 'order'
      ? [hostelLabel(a.hostelName), a.districtName, monthLabel(a.month), 'Whole order', '', '', '', timesMore(a.ratio).replace(' more', ''), IMPORTANCE[a.severity], `Compared per student with hostels of a similar size (${a.order?.itemsCompared} items)`]
      : [hostelLabel(a.hostelName), a.districtName, monthLabel(a.month), itemLabel(a.item, itemNames), unitFor(a.item, units), a.requested, a.expected, timesMore(a.ratio), IMPORTANCE[a.severity], METHOD_TEXT[a.method]]),
  ]);
}
