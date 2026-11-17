import { getDb } from '@/lib/db';
import { AccessError, actorOf, requireAccess, visibleDistricts } from '@/lib/viewer';
import { hostelLabel, monthLabel } from '@/lib/format';
import { daysSincePlaced, loadOrders, stageCells, STAGE_COLUMNS, TABS } from '@/lib/orders';
import { godownLabels } from '@/lib/dashboard';
import { xlsxResponse } from '@/lib/xlsx';
import { daysInStage, OPEN_STAGES, STAGE_LABEL } from '@anomaly/core';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The Stage Wise screen as a real Excel file. Every filter on the screen is applied, including the ones set by links (hostel, supplier-card orders). */
export async function GET(req: Request) {
  let viewer;
  try { viewer = await requireAccess('view'); } catch (e) { return new Response('Please sign in again.', { status: e instanceof AccessError ? e.status : 401 }); }
  const u = new URL(req.url);
  const g = (k: string) => u.searchParams.get(k) ?? '';
  const params = { stage: g('stage'), q: g('q'), month: g('month'), district: g('district'), account: g('account'), stuck: g('stuck'), ids: g('ids'), hostel: g('hostel') };
  const now = new Date();
  const c = await getDb();
  const [orders, label] = await Promise.all([loadOrders(c, params, await visibleDistricts(c, viewer), 20000, now), godownLabels(c)]);
  await c.auditLog.insertOne({ actor: actorOf(viewer), action: 'export.orders.xlsx', target: 'orders', at: now, details: { rows: orders.length, ...params } });
  const head = ['S.No', 'Request ID', 'Hostel ID', 'Hostel', 'District', 'Godown', 'Placed on', 'Current stage', 'Days at this stage', 'Days since placed',
    ...STAGE_COLUMNS.flatMap((s) => [`${s.label}: days`, `${s.label}: since`])];
  const rows = orders.map((o, i) => {
    const cells = stageCells(o, now);
    return [
      i + 1, o.requestId, o.hostelCode, hostelLabel(o.hostelName), o.districtName, label(o.account), o.placedOn, STAGE_LABEL[o.stage],
      OPEN_STAGES.includes(o.stage) ? daysInStage(o, now) : '', daysSincePlaced(o, now) ?? '',
      ...STAGE_COLUMNS.flatMap((s) => { const x = cells[s.key]; return x ? [x.days ?? '', x.since] : ['', '']; }),
    ];
  });
  return xlsxResponse(`stage-wise-${now.toISOString().slice(0, 10)}.xlsx`, { name: 'Stage wise', head, rows }, [
    ['Stage', params.stage ? (TABS.find((t) => t.key === params.stage)?.label ?? params.stage) : ''],
    ['Placed in (month)', params.month ? monthLabel(params.month) : ''],
    ['Godown', params.account ? label(params.account) : ''],
    ['District', params.district],
    ['Stuck for', params.stuck ? `${params.stuck}+ days` : ''],
    ['Hostel', params.hostel],
    ['Search', params.q],
    ['Limited to supplier-card orders', params.ids ? 'Yes' : ''],
  ]);
}
