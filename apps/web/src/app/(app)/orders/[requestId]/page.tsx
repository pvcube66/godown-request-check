import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { scopeFor } from '@/lib/viewer';
import { hostelLabel, itemLabel, num } from '@/lib/format';
import { daysSincePlaced, fmtDay, sourceNote, STAGE_COLUMNS, stageCells, urgency } from '@/lib/orders';
import { daysInStage, OPEN_STAGES, STAGE_LABEL, ACTIVE_STATES, STATE_TEXT, canEdit, scoped } from '@anomaly/core';
import { loadIndent } from '@/lib/indent';
import RemarksThread from '@/components/RemarksThread';
import FlagOrderForm from '../../issues/FlagOrderForm';
import RemarkForm from '../../issues/RemarkForm';
import { Icon } from '@/components/Icons';

export const dynamic = 'force-dynamic';

export default async function OrderPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const c = await getDb();
  const now = new Date();
  const { viewer, names } = await scopeFor(c);
  const o = await c.orders.findOne(scoped({ requestId: decodeURIComponent(requestId) }, names));
  if (!o) notFound();
  const rows = await loadIndent(c, o.requestId);
  const [remarks, issues] = await Promise.all([
    c.remarks.find({ targetType: 'order', targetId: o.requestId }).sort({ at: 1 }).toArray(),
    c.issues.find(scoped({ $or: [{ targetRequestIds: o.requestId }, { requestIds: o.requestId }, { newRequestId: o.requestId }] }, names)).sort({ raisedAt: -1 }).limit(10).toArray(),
  ]);
  const openIssue = issues.some((i) => ACTIVE_STATES.includes(i.state));
  const cells = stageCells(o, now);
  const steps = STAGE_COLUMNS.flatMap((c) => { const x = cells[c.key]; return x ? [{ key: c.key, label: c.label, ...x }] : []; });
  const u = urgency(o, now);
  const placed = daysSincePlaced(o, now);

  return (
    <>
      <p><Link href="/orders" className="link-arrow"><Icon name="back" size={16} /> Back to orders</Link></p>
      <section className="hero">
        <p className="greet">Order {o.requestId}</p>
        <h1>{hostelLabel(o.hostelName)}</h1>
        <p className="lede">
          Currently: <b>{STAGE_LABEL[o.stage]}</b>
          {OPEN_STAGES.includes(o.stage) ? <> for {num(daysInStage(o, now))} {daysInStage(o, now) === 1 ? 'day' : 'days'}</> : o.stage === 'received' ? <> on <span className="ack-date">{fmtDay(o.stageSince)}</span></> : <> (final action)</>}
          {u === 'late' && <> · <span className="bad-text">waiting over two weeks</span></>}
          {u === 'watch' && <> · waiting over a week</>}
        </p>
        <p className="status">Hostel ID {o.hostelCode} · {o.districtName} · {o.monthName} {o.academicYear}{placed !== null && <> · placed {fmtDay(o.placedOn)} ({num(placed)} {placed === 1 ? 'day' : 'days'} ago)</>}</p>
      </section>

      <section className="summary" aria-labelledby="timeline">
        <h2 id="timeline">Timeline</h2>
        <ol className="timeline">
          {steps.map((s) => (
            <li key={s.key} className={s.current ? 'now' : ''}>
              <b>{s.label}</b>
              {s.kind === 'counted' && <div>{fmtDay(s.since)} · {s.current ? `${num(s.days ?? 0)} ${s.days === 1 ? 'day' : 'days'} so far` : `lasted ${num(s.days ?? 0)} ${s.days === 1 ? 'day' : 'days'}`}</div>}
              {s.kind === 'ack' && <div className="ack-date">{fmtDay(s.since)} · received. The count stops here.</div>}
              {s.kind === 'final' && <div>{fmtDay(s.since)} · final action, no day count</div>}
              <div className="mut small">{sourceNote(s.source)}</div>
            </li>
          ))}
        </ol>
        {(o.stage === 'rejected' || o.stage === 'cancelled') && (
          <p className="mut small">We do not know when the order was {o.stage}. The portal keeps no date for it, so the time shown starts from when we first saw it.</p>
        )}
        <p className="mut small">Days are whole calendar days in India time. Dates marked “from the portal” come from the portal's own records.</p>
      </section>

      <section className="summary" aria-labelledby="details">
        <h2 id="details">Delivery details</h2>
        <ul>
          <li>Delivery note (DC) number: <b>{o.dcNumber ?? 'Not made yet'}</b></li>
          <li>Vehicle number: <b>{o.vehicleNo ?? 'Not recorded'}</b></li>
          <li>First seen by us: {fmtDay(o.firstSeenAt)} · last updated: {fmtDay(o.lastSeenAt)}</li>
        </ul>
      </section>

      <section aria-labelledby="items">
        <h2 id="items">Items requested</h2>
        {rows.length === 0 ? (
          <p className="mut">The item list for this order is not available yet. It appears after the next full check.</p>
        ) : (
          <div className="table-wrap">
            <table className="order-table">
              <thead><tr><th>Item</th><th>Quantity requested</th><th>Unit</th><th>Pack size</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.name}><td>{itemLabel(r.name)}</td><td>{num(r.quantity)}</td><td>{r.unit}</td><td>{r.packSize}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      {issues.length > 0 && (
        <section className="summary" aria-labelledby="order-issues">
          <h2 id="order-issues">Issues</h2>
          <ul>{issues.map((i) => <li key={i.issueId}><Link href={`/issues/${i.issueId}`}>{STATE_TEXT[i.state]}</Link> · raised {fmtDay(i.raisedAt)} by {i.raisedByName}</li>)}</ul>
        </section>
      )}

      <section className="summary" aria-labelledby="order-remarks">
        <h2 id="order-remarks">Remarks</h2>
        <RemarksThread remarks={remarks} />
        {canEdit(viewer) && <RemarkForm targetType="order" targetId={o.requestId} />}
      </section>

      {canEdit(viewer) && !openIssue && (
        <section className="summary" aria-labelledby="flag-order">
          <h2 id="flag-order">Flag this order</h2>
          <p className="master-note">Use this when you spot a problem the system did not. It adds the order to Issues so it can be followed. It does not change anything on the government portal.</p>
          <FlagOrderForm requestId={o.requestId} />
        </section>
      )}
    </>
  );
}
