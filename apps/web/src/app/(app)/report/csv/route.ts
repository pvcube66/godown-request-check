import { csvCell as cell } from '@/lib/csv';
import { getDb } from '@/lib/db';
import { loadItemNames } from '@/lib/item-names';
import { loadUnits } from '@/lib/units';
import { AccessError, actorOf, requireAccess, visibleDistricts } from '@/lib/viewer';
import { loadReport, REPORT_HEAD, reportRows } from '@/lib/report';

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
  const lines = reportRows(rows, itemNames, units).map((r) => r.map(cell).join(','));
  const head = REPORT_HEAD;
  const body = '﻿' + [head.map(cell).join(','), ...lines].join('\r\n');
  return new Response(body, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="unusual-requests-${new Date().toISOString().slice(0, 10)}.csv"`,
  } });
}
