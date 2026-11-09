import { getDb } from '@/lib/db';
import { hostelLabel, IMPORTANCE, itemLabel, METHOD_TEXT, monthLabel, timesMore } from '@/lib/format';
import { loadReport } from '@/lib/report';

export const dynamic = 'force-dynamic';
const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** CSV with a byte-order mark so Excel opens it with the right characters. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const rows = await loadReport(await getDb(), { month: u.searchParams.get('month') ?? '', district: u.searchParams.get('district') ?? '', q: u.searchParams.get('q') ?? '' });
  const head = ['Hostel', 'District', 'Month', 'Item', 'Asked for', 'Usually about', 'How much more', 'How important', 'How we compared'];
  const lines = rows.map((a) => [hostelLabel(a.hostelName), a.districtName, monthLabel(a.month), itemLabel(a.item), a.requested, a.expected, timesMore(a.ratio), IMPORTANCE[a.severity], METHOD_TEXT[a.method]].map(cell).join(','));
  const body = '﻿' + [head.map(cell).join(','), ...lines].join('\r\n');
  return new Response(body, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="unusual-requests-${new Date().toISOString().slice(0, 10)}.csv"`,
  } });
}
