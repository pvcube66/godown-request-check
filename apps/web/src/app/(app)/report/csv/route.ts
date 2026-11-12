import { csvCell as cell } from '@/lib/csv';
import { getDb } from '@/lib/db';
import { loadItemNames } from '@/lib/item-names';
import { loadUnits, unitFor } from '@/lib/units';
import { AccessError, actorOf, requireAccess, visibleDistricts } from '@/lib/viewer';
import { hostelLabel, IMPORTANCE, itemLabel, METHOD_TEXT, monthLabel, timesMore } from '@/lib/format';
import { loadReport } from '@/lib/report';

export const dynamic = 'force-dynamic';

/** CSV with a byte-order mark so Excel opens it with the right characters. */
export async function GET(req: Request) {
  let viewer;
  try { viewer = await requireAccess('view'); } catch (e) { return new Response('Please sign in again.', { status: e instanceof AccessError ? e.status : 401 }); }
  const u = new URL(req.url);
  const c = await getDb();
  const itemNames = await loadItemNames(c);
  const units = await loadUnits(c);
  const rows = await loadReport(c, { month: u.searchParams.get('month') ?? '', district: u.searchParams.get('district') ?? '', q: u.searchParams.get('q') ?? '' }, await visibleDistricts(c, viewer));
  await c.auditLog.insertOne({ actor: actorOf(viewer), action: 'export.report', target: 'report', at: new Date(), details: { rows: rows.length } });
  const head = ['S.No', 'Hostel ID', 'Hostel', 'District', 'Month', 'Item', 'Unit', 'Asked for', 'Usually about', 'How much more', 'How important', 'How we compared'];
  const lines = rows.map((a, i) => [
    i + 1, a.hostelCode,
    ...(a.kind === 'duplicate'
      ? [hostelLabel(a.hostelName), a.districtName, monthLabel(a.month), `Possible duplicate: ${a.dup?.requestIds.join(' and ')}`, '', '', '', `${Math.round((a.dup?.similarity ?? 0) * 100)}% the same`, IMPORTANCE[a.severity], `Two requests that match across ${a.dup?.items} items`]
      : a.kind === 'order'
      ? [hostelLabel(a.hostelName), a.districtName, monthLabel(a.month), 'Whole order', '', '', '', timesMore(a.ratio).replace(' more', ''), IMPORTANCE[a.severity], `Compared per student with hostels of a similar size (${a.order?.itemsCompared} items)`]
      : [hostelLabel(a.hostelName), a.districtName, monthLabel(a.month), itemLabel(a.item, itemNames), unitFor(a.item, units), a.requested, a.expected, timesMore(a.ratio), IMPORTANCE[a.severity], METHOD_TEXT[a.method]]),
  ].map(cell).join(','));
  const body = '﻿' + [head.map(cell).join(','), ...lines].join('\r\n');
  return new Response(body, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="unusual-requests-${new Date().toISOString().slice(0, 10)}.csv"`,
  } });
}
