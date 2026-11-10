import Link from 'next/link';
import { getDb } from '@/lib/db';
import { hostelLabel, num } from '@/lib/format';
import { daysSincePlaced, fmtDay, loadOrders, orderMonths, stageCells, STAGE_COLUMNS, stageCounts, TABS, urgency, type Urgency } from '@/lib/orders';
import { daysInStage, STAGE_LABEL } from '@anomaly/core';
import { Icon } from '@/components/Icons';

export const dynamic = 'force-dynamic';

type SP = { stage?: string; q?: string; month?: string; p?: string };
const PAGE_SIZE = 25;
const URGENCY_TEXT: Record<Urgency, string> = { late: 'Waiting a long time', watch: 'Waiting a while', ok: '' };
const qs = (cur: SP, patch: Partial<SP>) => {
  const p = new URLSearchParams(Object.entries({ ...cur, ...patch }).filter(([, v]) => v) as [string, string][]);
  return `/orders?${p}`;
};
const monthText = (ym: string) => new Date(`${ym}-01T12:00:00+05:30`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

export default async function Orders({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const c = await getDb();
  const now = new Date();
  const [all, counts, months] = await Promise.all([loadOrders(c, sp), stageCounts(c), orderMonths(c)]);
  const tab = TABS.find((t) => t.key === sp.stage)?.key ?? 'open';
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const pageNo = Math.min(Math.max(1, Number(sp.p) || 1), pages);
  const offset = (pageNo - 1) * PAGE_SIZE;
  const shown = all.slice(offset, offset + PAGE_SIZE);
  const base = Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== 'p')) as Record<string, string>;
  const late = all.filter((o) => urgency(o, now) === 'late').length;
  const lastSeen = all.reduce<Date | null>((m, o) => (!m || o.lastSeenAt > m ? o.lastSeenAt : m), null);

  return (
    <>
      <section className="hero">
        <p className="greet">Order tracking</p>
        <h1>{tab === 'open' ? `${num(counts.open ?? 0)} orders still in progress` : `${num(all.length)} ${all.length === 1 ? 'order' : 'orders'}${tab === 'all' ? '' : ` · ${TABS.find((t) => t.key === tab)?.label}`}`}</h1>
        <p className="lede">
          Every order from the portal, and how long it has been at its current stage. The longest-waiting orders are at the top.
          {late > 0 && <> <b>{num(late)}</b> {late === 1 ? 'has' : 'have'} been waiting over two weeks.</>}
        </p>
        <p className="status">{lastSeen ? <>Last updated from the portal {fmtDay(lastSeen)}.</> : 'No orders recorded yet. They appear after the next hourly check.'}</p>
      </section>

      <nav className="order-tabs" aria-label="Order stages">
        {TABS.map((t) => {
          const n = (counts as Record<string, number | undefined>)[t.key] ?? 0;
          const on = t.key === tab;
          return (
            <Link key={t.key} href={qs({ ...base, p: '' }, { stage: t.key === 'open' ? '' : t.key })} className={`order-tab ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined}>
              {t.label} <span className="order-tab-n">{num(n)}</span>
            </Link>
          );
        })}
      </nav>

      <form className="order-filters" method="get" action="/orders">
        {sp.stage && <input type="hidden" name="stage" value={sp.stage} />}
        <label className="select"><span>Placed in</span>
          <select name="month" defaultValue={sp.month ?? ''}>
            <option value="">Any month</option>
            {months.map((m) => <option key={m} value={m}>{monthText(m)}</option>)}
          </select>
        </label>
        <label className="search-box"><Icon name="search" size={18} />
          <input name="q" defaultValue={sp.q ?? ''} placeholder="Request number or hostel name" autoComplete="off" aria-label="Search orders" />
        </label>
        <button className="btn" type="submit">Show</button>
        {(sp.q || sp.month) && <Link href={qs({ stage: sp.stage ?? '' }, {})} className="link-arrow">Clear</Link>}
        <a className="btn" href={`/orders/csv?${new URLSearchParams(base)}`}><Icon name="download" size={16} /> Download Excel</a>
      </form>

      {all.length === 0 ? (
        <div className="empty">No orders match these choices.</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="order-table">
              <thead>
                <tr>
                  <th>S.No</th><th>Request ID</th><th>Hostel</th><th>Placed on</th><th>Current stage</th>
                  {STAGE_COLUMNS.map((c) => <th key={c.key} className="stage-col">{c.label}</th>)}
                  <th>Days since placed</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o, i) => {
                  const u = urgency(o, now);
                  const placed = daysSincePlaced(o, now);
                  const cells = stageCells(o, now);
                  return (
                    <tr key={o.requestId}>
                      <td>{offset + i + 1}</td>
                      <td><Link href={`/orders/${encodeURIComponent(o.requestId)}`}>{o.requestId}</Link></td>
                      <td><Link href={`/hostel/${o.hostelCode}`}>{hostelLabel(o.hostelName)}</Link><div className="mut small">Hostel ID {o.hostelCode} · {o.districtName}</div></td>
                      <td>{fmtDay(o.placedOn)}</td>
                      <td><b>{STAGE_LABEL[o.stage]}</b><div className="mut small">for {num(daysInStage(o, now))} {daysInStage(o, now) === 1 ? 'day' : 'days'}</div></td>
                      {STAGE_COLUMNS.map((c) => {
                        const cell = cells[c.key];
                        if (!cell) return <td key={c.key} className="stage-col none">—</td>;
                        const hot = cell.current ? u : 'ok';
                        return (
                          <td key={c.key} className={`stage-col ${cell.current ? 'current' : ''} ${hot === 'ok' ? '' : hot}`} title={cell.source === 'observed' ? 'Date we first saw this status' : 'Date from the portal'}>
                            <b>{num(cell.days)} {cell.days === 1 ? 'day' : 'days'}</b>
                            <div className="mut small">{cell.current ? 'still here' : 'done'} · since {fmtDay(cell.since)}</div>
                            {cell.source === 'observed' && <div className="mut small">first seen by us</div>}
                          </td>
                        );
                      })}
                      <td>{placed === null ? '—' : `${num(placed)} ${placed === 1 ? 'day' : 'days'}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <nav className="pager" aria-label="More orders">
            <span className="mut">Orders {offset + 1} to {Math.min(offset + PAGE_SIZE, all.length)} of {all.length}</span>
            {pageNo > 1 ? <Link className="btn" href={qs(base, { p: String(pageNo - 1) })}>Previous</Link> : <span />}
            {pageNo < pages ? <Link className="btn primary-ish" href={qs(base, { p: String(pageNo + 1) })}>Next</Link> : <span />}
          </nav>
          <p className="mut small">
            Days are counted from the date the portal gives for each stage. For cancelled and rejected orders the portal gives no date, so the count starts from when we first saw that status.
          </p>
        </>
      )}
    </>
  );
}
