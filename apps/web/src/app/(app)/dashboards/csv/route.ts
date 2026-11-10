import { STAGE_LABEL } from '@anomaly/core';
import { csvResponse } from '@/lib/csv';
import { getDb } from '@/lib/db';
import { godownLabels, loadSummaryOrders, stageSummary, summarize, SUMMARY_STAGES, VIEWS, type View } from '@/lib/dashboard';
import { STUCK_DAYS } from '@/lib/orders';
import { AccessError, actorOf, requireAccess, visibleDistricts } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

/** The same numbers as the dashboard for the chosen view and month, for the person's districts only. */
export async function GET(req: Request) {
  let viewer;
  try { viewer = await requireAccess('view'); } catch (e) { return new Response('Please sign in again.', { status: e instanceof AccessError ? e.status : 401 }); }
  const u = new URL(req.url);
  const view = (VIEWS.find((v) => v.key === u.searchParams.get('view'))?.key ?? 'overall') as View;
  const m = u.searchParams.get('month') ?? '';
  const month = /^\d{4}-\d{2}$/.test(m) ? m : undefined;
  const c = await getDb();
  const now = new Date();
  const rows = await loadSummaryOrders(c, await visibleDistricts(c, viewer), month);
  await c.auditLog.insertOne({ actor: actorOf(viewer), action: 'export.dashboard', target: view, at: now, details: { month: month ?? '', orders: rows.length } });
  const stuck = [`${STUCK_DAYS[0]}+ days`, `${STUCK_DAYS[1]}+ days`];
  const name = `dashboard-${view}-${now.toISOString().slice(0, 10)}.csv`;
  if (view === 'overall') {
    const s = stageSummary(rows, now);
    return csvResponse(name, ['S.No', 'Stage', 'Orders', 'Hostels', ...stuck], [...s.rows.map((r, i) => [i + 1, r.label, r.orders, r.hostels, r.stuck7, r.stuck15]), ['', 'All orders', s.total, '', s.rows.reduce((n, r) => n + r.stuck7, 0), s.rows.reduce((n, r) => n + r.stuck15, 0)]]);
  }
  const matrix = summarize(rows, view, now, await godownLabels(c));
  return csvResponse(name, ['S.No', view === 'district' ? 'District' : 'Godown', 'Hostels', ...SUMMARY_STAGES.map((s) => STAGE_LABEL[s]), 'Total', ...stuck],
    [...matrix.map((r, i) => [i + 1, r.label, r.hostels, ...SUMMARY_STAGES.map((s) => r.byStage[s]), r.total, r.stuck7, r.stuck15]),
      ['', 'All', '', ...SUMMARY_STAGES.map((s) => matrix.reduce((n, r) => n + r.byStage[s], 0)), matrix.reduce((n, r) => n + r.total, 0), matrix.reduce((n, r) => n + r.stuck7, 0), matrix.reduce((n, r) => n + r.stuck15, 0)]]);
}
