import { getDb } from '@/lib/db';
import { hostelLabel } from '@/lib/format';
import { daysSincePlaced, fmtDay, loadOrders } from '@/lib/orders';
import { daysInStage, STAGE_LABEL } from '@anomaly/core';

export const dynamic = 'force-dynamic';
const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** Same rows as the Orders screen (same filters), as an Excel-friendly CSV with a byte-order mark. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const now = new Date();
  const orders = await loadOrders(await getDb(), { stage: u.searchParams.get('stage') ?? '', q: u.searchParams.get('q') ?? '', month: u.searchParams.get('month') ?? '' }, 5000);
  const head = ['S.No', 'Request ID', 'Hostel ID', 'Hostel', 'District', 'Placed on', 'Current stage', 'At this stage since', 'Days at this stage', 'Days since placed', 'Date source'];
  const lines = orders.map((o, i) => [
    i + 1, o.requestId, o.hostelCode, hostelLabel(o.hostelName), o.districtName, fmtDay(o.placedOn),
    STAGE_LABEL[o.stage], fmtDay(o.stageSince), daysInStage(o, now), daysSincePlaced(o, now) ?? '',
    o.stages.at(-1)?.source === 'portal' ? 'Portal' : 'First seen by us',
  ].map(cell).join(','));
  const body = '﻿' + [head.map(cell).join(','), ...lines].join('\r\n');
  return new Response(body, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="orders-${now.toISOString().slice(0, 10)}.csv"`,
  } });
}
