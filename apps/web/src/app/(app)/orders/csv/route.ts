import { csvCell as cell } from '@/lib/csv';
import { getDb } from '@/lib/db';
import { AccessError, actorOf, requireAccess, visibleDistricts } from '@/lib/viewer';
import { hostelLabel } from '@/lib/format';
import { daysSincePlaced, fmtDay, loadOrders, stageCells, STAGE_COLUMNS } from '@/lib/orders';
import { daysInStage, OPEN_STAGES, STAGE_LABEL } from '@anomaly/core';

export const dynamic = 'force-dynamic';

/** Same rows as the Orders screen (same filters), as an Excel-friendly CSV with a byte-order mark. */
export async function GET(req: Request) {
  let viewer;
  try { viewer = await requireAccess('view'); } catch (e) { return new Response('Please sign in again.', { status: e instanceof AccessError ? e.status : 401 }); }
  const u = new URL(req.url);
  const now = new Date();
  const c = await getDb();
  const orders = await loadOrders(c, { stage: u.searchParams.get('stage') ?? '', q: u.searchParams.get('q') ?? '', month: u.searchParams.get('month') ?? '', district: u.searchParams.get('district') ?? '', account: u.searchParams.get('account') ?? '', stuck: u.searchParams.get('stuck') ?? '' }, await visibleDistricts(c, viewer), 5000, now);
  await c.auditLog.insertOne({ actor: actorOf(viewer), action: 'export.orders', target: 'orders', at: now, details: { rows: orders.length, stage: u.searchParams.get('stage') ?? '', q: u.searchParams.get('q') ?? '', month: u.searchParams.get('month') ?? '' } });
  const head = ['S.No', 'Request ID', 'Hostel ID', 'Hostel', 'District', 'Placed on', 'Current stage', 'Days at this stage', 'Days since placed',
    ...STAGE_COLUMNS.flatMap((c) => [`${c.label}: days`, `${c.label}: since`])];
  const lines = orders.map((o, i) => {
    const cells = stageCells(o, now);
    return [
      i + 1, o.requestId, o.hostelCode, hostelLabel(o.hostelName), o.districtName, fmtDay(o.placedOn),
      STAGE_LABEL[o.stage], OPEN_STAGES.includes(o.stage) ? daysInStage(o, now) : '', daysSincePlaced(o, now) ?? '',
      ...STAGE_COLUMNS.flatMap((c) => { const x = cells[c.key]; return x ? [x.days ?? '', fmtDay(x.since)] : ['', '']; }),
    ].map(cell).join(',');
  });
  const body = '﻿' + [head.map(cell).join(','), ...lines].join('\r\n');
  return new Response(body, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="orders-${now.toISOString().slice(0, 10)}.csv"`,
  } });
}
