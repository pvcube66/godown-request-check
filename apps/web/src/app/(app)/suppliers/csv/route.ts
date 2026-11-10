import { csvResponse } from '@/lib/csv';
import { getDb } from '@/lib/db';
import { VERDICT_TEXT } from '@/lib/performance';
import { loadPerformanceView } from '@/lib/performance-view';
import { AccessError, actorOf, requireAccess, visibleDistricts } from '@/lib/viewer';

export const dynamic = 'force-dynamic';
const pct = (x: number | null) => (x === null ? '' : Math.round(x * 1000) / 10);
const dec = (x: number | null) => (x === null ? '' : Math.round(x * 10) / 10);

export async function GET(req: Request) {
  let viewer;
  try { viewer = await requireAccess('view'); } catch (e) { return new Response('Please sign in again.', { status: e instanceof AccessError ? e.status : 401 }); }
  const u = new URL(req.url);
  const c = await getDb();
  const now = new Date();
  const v = await loadPerformanceView(c, await visibleDistricts(c, viewer), { by: u.searchParams.get('by') ?? '', month: u.searchParams.get('month') ?? '', focus: u.searchParams.get('focus') ?? '' }, now);
  await c.auditLog.insertOne({ actor: actorOf(viewer), action: 'export.performance', target: v.by, at: now, details: { month: v.month ?? '', focus: v.focus ?? '', orders: v.total } });
  const head = [v.by === 'supplier' ? 'Supplier' : v.by === 'godown' ? 'Godown' : v.by === 'district' ? 'District' : 'Hostel', 'Orders', 'Orders read for quantities', 'Supplied % (of what was asked)', 'Received % (of what was supplied)', 'Days to DC', 'Days DC to dispatch', 'Days dispatch to acknowledge', 'Open orders', 'Open 7+ days', 'Open 15+ days', 'Rejected %', 'With variation %', 'Against average (points)', 'Meeting demand?'];
  const line = (r: (typeof v.main.rows)[number]) => [r.label, r.orders, r.read, pct(r.fill), pct(r.receivedFill), dec(r.daysToDc), dec(r.daysDcToDispatch), dec(r.daysToAcknowledge), r.backlog, r.backlog7, r.backlog15, pct(r.rejectedShare), pct(r.variationShare), r.vsAverage === null ? '' : Math.round(r.vsAverage), VERDICT_TEXT[r.verdict]];
  return csvResponse(`performance-${v.by}-${now.toISOString().slice(0, 10)}.csv`, head, [...v.main.rows.map(line), line({ ...v.main.overall, label: 'All in view' })]);
}
