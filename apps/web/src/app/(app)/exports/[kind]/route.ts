import { OPEN_STAGES, STATE_TEXT, STAGE_LABEL, daysInStage, OUTCOME_TEXT } from '@anomaly/core';
import { csvResponse } from '@/lib/csv';
import { getDb } from '@/lib/db';
import { fmtDay } from '@/lib/orders';
import { AccessError, actorOf, requireAccess } from '@/lib/viewer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EXPORT_KINDS = ['orders', 'flags', 'issues', 'remarks'] as const;
type Kind = (typeof EXPORT_KINDS)[number];
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : '');

/** The full, unfiltered copy of what the system holds (the one-year hand-over copy). Administrators only. Every download is logged. */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  let viewer;
  try { viewer = await requireAccess('admin'); } catch (e) { return new Response('Only an administrator can download the full copy.', { status: e instanceof AccessError ? e.status : 401 }); }
  const { kind } = await params;
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return new Response('Not found', { status: 404 });
  const c = await getDb();
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const done = async (rows: number) => { await c.auditLog.insertOne({ actor: actorOf(viewer), action: 'export.full', target: kind, at: now, details: { rows } }); };

  switch (kind as Kind) {
    case 'orders': {
      const rows = (await c.orders.find({}).sort({ placedOn: 1, requestId: 1 }).toArray()).map((o) => [
        o.requestId, o.account, o.hostelCode, o.hostelName, o.districtName, o.monthName, o.academicYear, fmtDay(o.placedOn), STAGE_LABEL[o.stage], o.rawStatus,
        OPEN_STAGES.includes(o.stage) ? daysInStage(o, now) : '', iso(o.stageSince), iso(o.reached?.pending), iso(o.reached?.dc), iso(o.reached?.transit), iso(o.reached?.received),
        o.dcNumber ?? '', o.vehicleNo ?? '', iso(o.firstSeenAt), iso(o.lastSeenAt),
      ]);
      await done(rows.length);
      return csvResponse(`all-orders-${stamp}.csv`, ['Request ID', 'Godown login', 'Hostel ID', 'Hostel', 'District', 'Month', 'Academic year', 'Placed on', 'Stage', 'Portal status', 'Days at this stage (open stages only)', 'Stage since', 'Pending date', 'DC date', 'In-Transit date', 'Acknowledge date', 'DC number', 'Vehicle', 'First seen', 'Last seen'], rows);
    }
    case 'flags': {
      const rows = (await c.anomalies.find({}).sort({ detectedAt: 1, key: 1 }).toArray()).map((a) => [a.key, a.hostelCode, a.hostelName, a.districtName, a.month, a.kind, a.item, a.requested, a.expected, a.ratio, a.severity, a.status, a.reason, iso(a.detectedAt), iso(a.updatedAt)]);
      await done(rows.length);
      return csvResponse(`all-flags-${stamp}.csv`, ['Key', 'Hostel ID', 'Hostel', 'District', 'Month', 'Type', 'Item', 'Asked for', 'Usually about', 'Times more', 'Importance', 'Status', 'Why flagged', 'First flagged', 'Last changed'], rows);
    }
    case 'issues': {
      const rows = (await c.issues.find({}).sort({ raisedAt: 1 }).toArray()).map((i) => [i.issueId, i.source === 'manual' ? 'Flagged by hand' : 'From a flag', i.hostelCode, i.hostelName, i.districtName, i.month, STATE_TEXT[i.state], i.reason, i.raisedByName, iso(i.raisedAt), iso(i.rejectedAt), i.newRequestId ?? '', iso(i.newIndentAt), iso(i.closedAt), i.closeNote ?? '', i.targetRequestIds.join(' ')]);
      await done(rows.length);
      return csvResponse(`all-issues-${stamp}.csv`, ['Issue', 'How it started', 'Hostel ID', 'Hostel', 'District', 'Month', 'Where it stands', 'Reason', 'Raised by', 'Raised', 'Rejected on portal (seen)', 'New indent', 'New indent seen', 'Closed', 'Closing note', 'Requests to reject'], rows);
    }
    case 'remarks': {
      const rows = (await c.remarks.find({}).sort({ at: 1 }).toArray()).map((r) => [r.targetType === 'issue' ? 'Issue' : 'Order', r.targetId, r.authorName, iso(r.at), r.outcome ? OUTCOME_TEXT[r.outcome] : '', r.text]);
      await done(rows.length);
      return csvResponse(`all-remarks-${stamp}.csv`, ['About', 'Issue or request ID', 'Written by', 'When', 'Call result', 'Remark'], rows);
    }
  }
}
