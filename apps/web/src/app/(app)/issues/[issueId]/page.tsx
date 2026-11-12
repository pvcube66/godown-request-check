import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ACTIVE_STATES, canEdit, getWaitDays, isOverdue, scoped, STATE_TEXT, waitingDays } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { loadItemNames } from '@/lib/item-names';
import { hostelLabel, itemLabel, monthLabel, num, when } from '@/lib/format';
import { flaggedItemName, isFlaggedRow, loadIndent } from '@/lib/indent';
import { fmtDay } from '@/lib/orders';
import { scopeFor } from '@/lib/viewer';
import { Icon } from '@/components/Icons';
import RemarksThread from '@/components/RemarksThread';
import CloseForm from '../CloseForm';
import RemarkForm from '../RemarkForm';

export const dynamic = 'force-dynamic';

export default async function IssuePage({ params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await params;
  const c = await getDb();
  const [itemNames, { viewer, names }, waitDays] = await Promise.all([loadItemNames(c), scopeFor(c), getWaitDays(c)]);
  const issue = await c.issues.findOne(scoped({ issueId }, names));
  if (!issue) notFound();
  const now = new Date();
  const [remarks, flags] = await Promise.all([
    c.remarks.find({ targetType: 'issue', targetId: issue.issueId }).sort({ at: 1 }).toArray(),
    issue.anomalyKeys.length ? c.anomalies.find(scoped({ key: { $in: issue.anomalyKeys } }, names)).toArray() : [],
  ]);
  const flagged = new Set(flags.map((a) => flaggedItemName(a.item)));
  const shownIds = [...new Set([...issue.targetRequestIds, ...(issue.newRequestId ? [issue.newRequestId] : [])])];
  const indents = await Promise.all(shownIds.map(async (id) => ({ id, rows: await loadIndent(c, id, { live: false }), isNew: id === issue.newRequestId })));
  const w = waitingDays(issue, now); const late = isOverdue(issue, waitDays, now);
  const open = ACTIVE_STATES.includes(issue.state);

  return (
    <>
      <p><Link href="/issues" className="link-arrow"><Icon name="back" size={16} /> Back to issues</Link></p>
      <section className="hero">
        <p className="greet">Issue for {monthLabel(issue.month)}</p>
        <h1><Link href={`/hostel/${issue.hostelCode}?g=${issue.godownId}`}>{hostelLabel(issue.hostelName)}</Link></h1>
        <p className="lede"><b>{STATE_TEXT[issue.state]}</b>{w !== null && <> · {num(w)} {w === 1 ? 'day' : 'days'} without a new indent{late && <> · <span className="bad-text">overdue (alert after {waitDays})</span></>}</>}</p>
        <p className="status">Hostel ID {issue.hostelCode} · {issue.districtName} · raised {fmtDay(issue.raisedAt)} by {issue.raisedByName}{issue.source === 'manual' ? ' (flagged by hand)' : ''}</p>
      </section>

      {open && (
        <section className="summary" aria-labelledby="next-step">
          <h2 id="next-step">What to do next</h2>
          {issue.state === 'issue_raised'
            ? <p>Reject {issue.targetRequestIds.length === 1 ? 'this indent' : 'the wrong indent'} on the government portal ({issue.targetRequestIds.join(', ') || 'see below'}). This system only reads the portal and cannot do it for you. We will see the rejection within the hour.</p>
            : <p>The rejection is on the portal. We are waiting for the hostel to send a new indent for {monthLabel(issue.month)}. If none comes in {waitDays} {waitDays === 1 ? 'day' : 'days'}, this is shown as overdue. Call the hostel and add a remark below.</p>}
        </section>
      )}

      <section className="summary" aria-labelledby="progress">
        <h2 id="progress">Progress</h2>
        <ol className="timeline">
          {issue.history.map((h, i) => <li key={i}><b>{STATE_TEXT[h.state]}</b><div>{when(h.at)} · {h.by === 'system' ? 'seen in the hourly check' : h.by === issue.raisedBy ? issue.raisedByName : 'a team member'}</div>{h.note && <div className="mut small">{h.note}</div>}</li>)}
        </ol>
        {issue.state === 'resolved' && issue.newRequestId && <p>The new indent is <Link href={`/orders/${encodeURIComponent(issue.newRequestId)}`}>{issue.newRequestId}</Link>.</p>}
        {issue.state === 'closed' && <p className="mut">Closed: {issue.closeNote}</p>}
      </section>

      {flags.length > 0 && (
        <section className="summary" aria-labelledby="flags">
          <h2 id="flags">What the system noticed</h2>
          <ul>{flags.map((a) => <li key={a.key}>{a.kind === 'order' ? 'Whole order too big' : a.kind === 'duplicate' ? 'Possible duplicate request' : a.kind === 'typing' ? 'Same number typed for many items' : `${itemLabel(a.item, itemNames)}: asked for ${num(a.requested)}, usually about ${num(a.expected)}`}</li>)}</ul>
        </section>
      )}

      {indents.map((ind) => (
        <section key={ind.id} aria-labelledby={`indent-${ind.id}`}>
          <h2 id={`indent-${ind.id}`} className="sub">{ind.isNew ? 'New indent' : 'Indent'} {ind.id} <Link className="link-arrow small" href={`/orders/${encodeURIComponent(ind.id)}`}>open order</Link></h2>
          {ind.rows.length === 0 ? <p className="mut">The item list is not available yet.</p> : (
            <div className="table-wrap"><table className="order-table">
              <thead><tr><th>Item</th><th>Quantity</th><th>Pack size</th></tr></thead>
              <tbody>{ind.rows.map((r) => <tr key={r.name} className={!ind.isNew && isFlaggedRow(r, flagged) ? 'flagged-row' : ''}><td>{itemLabel(r.name)}{!ind.isNew && isFlaggedRow(r, flagged) && <b className="tag-flag"> ◀ flagged</b>}</td><td>{num(r.quantity)} {r.unit}</td><td>{r.packSize}</td></tr>)}</tbody>
            </table></div>
          )}
        </section>
      ))}

      <section className="summary" aria-labelledby="remarks">
        <h2 id="remarks">Remarks</h2>
        <RemarksThread remarks={remarks} />
        {canEdit(viewer) && <RemarkForm targetType="issue" targetId={issue.issueId} />}
      </section>

      {open && canEdit(viewer) && (
        <section className="summary" aria-labelledby="close">
          <h2 id="close">Close without a new indent</h2>
          <p className="master-note">Use this only if no new indent is needed. Say why.</p>
          <CloseForm issueId={issue.issueId} />
        </section>
      )}
    </>
  );
}
