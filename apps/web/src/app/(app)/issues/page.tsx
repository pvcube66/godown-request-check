import Link from 'next/link';
import { getWaitDays, isOverdue, STATE_TEXT, waitingDays } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { hostelLabel, monthLabel, num } from '@/lib/format';
import { fmtDay } from '@/lib/orders';
import { ISSUE_TABS, issueCounts, loadIssues, type IssueTab } from '@/lib/issues';
import { scopeFor } from '@/lib/viewer';
import WaitDaysForm from './WaitDaysForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Issues' };

export default async function Issues({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const c = await getDb();
  const { viewer, names } = await scopeFor(c);
  const tab = (ISSUE_TABS.find((t) => t.key === sp.tab)?.key ?? 'waiting') as IssueTab;
  const now = new Date();
  const [list, counts, waitDays] = await Promise.all([loadIssues(c, tab, names), issueCounts(c, names), getWaitDays(c)]);
  const overdue = list.filter((i) => isOverdue(i, waitDays, now)).length;

  return (
    <>
      <section className="hero">
        <p className="greet">Issues</p>
        <h1>{num(counts.waiting!)} waiting for a new indent</h1>
        <p className="lede">Wrong indents waiting for the hostel to send a new one. Overdue after {waitDays} {waitDays === 1 ? 'day' : 'days'}.</p>
      </section>
      <div className="order-seg-wrap">
        <nav className="seg order-seg" aria-label="Issue lists">
          {ISSUE_TABS.map((t) => <Link key={t.key} href={`/issues?tab=${t.key}`} className={t.key === tab ? 'on' : ''} aria-current={t.key === tab ? 'page' : undefined}>{t.label}<span className="order-tab-n">{num(counts[t.key] ?? 0)}</span></Link>)}
        </nav>
      </div>
      {tab === 'waiting' && overdue > 0 && <p className="status bad" role="status"><b>{num(overdue)}</b> {overdue === 1 ? 'hostel has' : 'hostels have'} waited {waitDays}+ {waitDays === 1 ? 'day' : 'days'} for a new indent.</p>}
      {list.length === 0 ? <div className="empty">Nothing in this list.</div> : (
        <div className="table-wrap"><table className="order-table">
          <thead><tr><th>S.No</th><th>Hostel</th><th>District</th><th>Month</th><th>Raised</th><th>Where it stands</th><th>Days waiting</th><th>Reason</th></tr></thead>
          <tbody>{list.map((i, n) => {
            const w = waitingDays(i, now); const late = isOverdue(i, waitDays, now);
            return (
              <tr key={i.issueId}>
                <td>{n + 1}</td>
                <td><Link href={`/issues/${i.issueId}`}>{hostelLabel(i.hostelName)}</Link><div className="mut small">Hostel ID {i.hostelCode}</div></td>
                <td>{i.districtName}</td><td>{monthLabel(i.month)}</td>
                <td>{fmtDay(i.raisedAt)}<div className="mut small">by {i.raisedByName}{i.source === 'manual' ? ' · flagged by hand' : ''}</div></td>
                <td>{STATE_TEXT[i.state]}{i.state === 'resolved' && i.newRequestId && <div className="mut small">New indent {i.newRequestId}</div>}</td>
                <td className={late ? 'late' : ''}>{w === null ? '—' : <><b>{num(w)} {w === 1 ? 'day' : 'days'}</b>{late && <div className="small">overdue</div>}</>}</td>
                <td className="mut small">{i.reason.length > 90 ? `${i.reason.slice(0, 90)}…` : i.reason}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {viewer.role === 'admin' && (
        <section className="master-section" aria-labelledby="wait-setting" style={{ marginTop: 18 }}>
          <h2 id="wait-setting">Alert after how many days?</h2>
          <p className="master-note">Counted in whole calendar days from the day we saw the rejection on the portal. It applies to every godown.</p>
          <WaitDaysForm days={waitDays} />
        </section>
      )}
    </>
  );
}
