import { OPEN_STAGES, STATE_TEXT, STAGE_LABEL, daysInStage, OUTCOME_TEXT, type IssueState } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { fmtDay, orderFilter, TABS } from '@/lib/orders';
import { monthLabel } from '@/lib/format';
import { xlsxResponse, type XCell } from '@/lib/xlsx';
import { AccessError, actorOf, requireAccess } from '@/lib/viewer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EXPORT_KINDS = ['orders', 'flags', 'issues', 'remarks'] as const;
type Kind = (typeof EXPORT_KINDS)[number];
const FLAG_STATUS = ['open', 'confirmed', 'ignored', 'expected', 'resolved'] as const;
const ISSUE_STATES = Object.keys(STATE_TEXT) as IssueState[];
const d = (x: Date | null | undefined): Date | null => x ?? null;

/** The month (yyyy-mm, India time) as a date range, for things stamped with a moment rather than a month. */
function monthRange(m: string) {
  const x = /^(\d{4})-(\d{2})$/.exec(m);
  if (!x) return null;
  const start = new Date(`${x[1]}-${x[2]}-01T00:00:00+05:30`);
  const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
  return { $gte: start, $lt: end };
}

/** The full copy of what the system holds (the one-year hand-over copy), optionally narrowed by month, district, godown and a status. Administrators only. Every download is logged. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  let viewer;
  try { viewer = await requireAccess('admin'); } catch (e) { return new Response('Only an administrator can download the full copy.', { status: e instanceof AccessError ? e.status : 401 }); }
  const { kind } = await params;
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return new Response('Not found', { status: 404 });
  const u = new URL(req.url);
  const g = (k: string) => (u.searchParams.get(k) ?? '').trim();
  const month = /^\d{4}-\d{2}$/.test(g('month')) ? g('month') : '';
  const district = g('district').slice(0, 80);
  const godownId = /^\d{1,9}$/.test(g('godown')) ? Number(g('godown')) : null;
  const c = await getDb();
  const godown = godownId === null ? null : await c.godowns.findOne({ godownId });
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const applied: [string, string][] = [['Month', month ? monthLabel(month) : ''], ['District', district], ['Godown', godown ? godown.name : godownId !== null ? String(godownId) : '']];
  const done = async (rows: number) => { await c.auditLog.insertOne({ actor: actorOf(viewer), action: 'export.full', target: kind, at: now, details: { rows, month, district, godownId } }); };
  const send = async (name: string, head: string[], rows: XCell[][], extra: [string, string][] = []) => {
    await done(rows.length);
    return xlsxResponse(`all-${name}-${stamp}.xlsx`, { name, head, rows }, [...applied, ...extra]);
  };
  // a godown that has no portal login on record can never match an order, so the list is empty rather than everything
  const noMatch = godownId !== null && !godown;

  switch (kind as Kind) {
    case 'orders': {
      const stage = TABS.find((t) => t.key === g('stage'))?.key ?? 'all';
      const f = orderFilter({ month, district, stage, account: godown?.portalLogin });
      const list = noMatch ? [] : await c.orders.find(f as never).sort({ placedOn: 1, requestId: 1 }).toArray();
      const rows = list.map((o) => [
        o.requestId, o.account, o.hostelCode, o.hostelName, o.districtName, o.monthName, o.academicYear, fmtDay(o.placedOn), STAGE_LABEL[o.stage], o.rawStatus,
        OPEN_STAGES.includes(o.stage) ? daysInStage(o, now) : '', d(o.stageSince), d(o.reached?.pending), d(o.reached?.dc), d(o.reached?.transit), d(o.reached?.received),
        o.dcNumber ?? '', o.vehicleNo ?? '', d(o.firstSeenAt), d(o.lastSeenAt),
      ]);
      return send('orders', ['Request ID', 'Godown login', 'Hostel ID', 'Hostel', 'District', 'Month', 'Academic year', 'Placed on', 'Stage', 'Portal status', 'Days at this stage (open stages only)', 'Stage since', 'Pending date', 'DC date', 'In-Transit date', 'Acknowledge date', 'DC number', 'Vehicle', 'First seen', 'Last seen'], rows,
        [['Month means', 'Month the order was placed'], ['Stage', stage === 'all' ? '' : (TABS.find((t) => t.key === stage)?.label ?? '')]]);
    }
    case 'flags': {
      const status = (FLAG_STATUS as readonly string[]).includes(g('status')) ? g('status') : '';
      const f: Record<string, unknown> = {};
      if (month) f.month = month;
      if (district) f.districtName = district;
      if (godownId !== null) f.godownId = godownId;
      if (status) f.status = status;
      const rows = (await c.anomalies.find(f as never).sort({ detectedAt: 1, key: 1 }).toArray()).map((a) => [a.key, a.hostelCode, a.hostelName, a.districtName, a.month, a.kind, a.item, a.requested, a.expected, a.ratio, a.severity, a.status, a.reason, d(a.detectedAt), d(a.updatedAt)]);
      return send('flags', ['Key', 'Hostel ID', 'Hostel', 'District', 'Month', 'Type', 'Item', 'Asked for', 'Usually about', 'Times more', 'Importance', 'Status', 'Why flagged', 'First flagged', 'Last changed'], rows,
        [['Month means', 'Month the goods were requested for'], ['Status', status]]);
    }
    case 'issues': {
      const state = (ISSUE_STATES as string[]).includes(g('state')) ? (g('state') as IssueState) : null;
      const f: Record<string, unknown> = {};
      if (month) f.month = month;
      if (district) f.districtName = district;
      if (godownId !== null) f.godownId = godownId;
      if (state) f.state = state;
      const rows = (await c.issues.find(f as never).sort({ raisedAt: 1 }).toArray()).map((i) => [i.issueId, i.source === 'manual' ? 'Flagged by hand' : 'From a flag', i.hostelCode, i.hostelName, i.districtName, i.month, STATE_TEXT[i.state], i.reason, i.raisedByName, d(i.raisedAt), d(i.rejectedAt), i.newRequestId ?? '', d(i.newIndentAt), d(i.closedAt), i.closeNote ?? '', i.targetRequestIds.join(' ')]);
      return send('issues', ['Issue', 'How it started', 'Hostel ID', 'Hostel', 'District', 'Month', 'Where it stands', 'Reason', 'Raised by', 'Raised', 'Rejected on portal (seen)', 'New indent', 'New indent seen', 'Closed', 'Closing note', 'Requests to reject'], rows,
        [['Month means', 'Month the goods were requested for'], ['Where it stands', state ? STATE_TEXT[state] : '']]);
    }
    case 'remarks': {
      const f: Record<string, unknown> = {};
      const range = month ? monthRange(month) : null;
      if (range) f.at = range;
      let list = await c.remarks.find(f as never).sort({ at: 1 }).toArray();
      if (district || godownId !== null) {
        // a remark belongs to an issue or an order, which carry the district and godown
        const issueIds = list.filter((r) => r.targetType === 'issue').map((r) => r.targetId);
        const orderIds = list.filter((r) => r.targetType !== 'issue').map((r) => r.targetId);
        const [iss, ord] = await Promise.all([
          issueIds.length ? c.issues.find({ issueId: { $in: issueIds } }, { projection: { issueId: 1, districtName: 1, godownId: 1 } }).toArray() : [],
          orderIds.length ? c.orders.find({ requestId: { $in: orderIds } }, { projection: { requestId: 1, districtName: 1, account: 1 } }).toArray() : [],
        ]);
        const okIssue = new Set(iss.filter((i) => (!district || i.districtName === district) && (godownId === null || i.godownId === godownId)).map((i) => i.issueId));
        const okOrder = new Set(ord.filter((o) => (!district || o.districtName === district) && (!godown || o.account === godown.portalLogin)).map((o) => o.requestId));
        list = list.filter((r) => (r.targetType === 'issue' ? okIssue.has(r.targetId) : okOrder.has(r.targetId)));
      }
      const rows = list.map((r) => [r.targetType === 'issue' ? 'Issue' : 'Order', r.targetId, r.authorName, d(r.at), r.outcome ? OUTCOME_TEXT[r.outcome] : '', r.text]);
      return send('remarks', ['About', 'Issue or request ID', 'Written by', 'When', 'Call result', 'Remark'], rows, [['Month means', 'Month the remark was written']]);
    }
  }
}
