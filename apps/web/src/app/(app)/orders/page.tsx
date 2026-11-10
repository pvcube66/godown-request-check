import Link from 'next/link';
import { getDb } from '@/lib/db';
import { scopeFor } from '@/lib/viewer';
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
  const { names } = await scopeFor(c);
  const now = new Date();
  const [all, counts, months] = await Promise.all([loadOrders(c, sp, names), stageCounts(c, names), orderMonths(c, names)]);
  const tab = TABS.find((t) => t.key === sp.stage)?.key ?? 'all';
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const pageNo = Math.min(Math.max(1, Number(sp.p) || 1), pages);
  const offset = (pageNo - 1) * PAGE_SIZE;
  const shown = all.slice(offset, offset + PAGE_SIZE);
  const base = Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== 'p')) as Record<string, string>;
  const late = all.filter((o) => urgency(o, now) === 'late').length;
  const lastSeen = all.reduce<Date | null>((m, o) => (!m || o.lastSeenAt > m ? o.lastSeenAt : m), null);

  return (
    <div className="orders-page">
      <section className="hero">
        <p className="greet">Order tracking</p>
        <h1>{num(all.length)} {tab === 'all' ? (all.length === 1 ? 'order' : 'orders') : `${TABS.find((t) => t.key === tab)?.label} ${all.length === 1 ? 'order' : 'orders'}`}</h1>
        <p className="lede">
          Every order from the portal, and how long it has been at its current stage. The longest-waiting orders are at the top.
          {late > 0 && <> <b>{num(late)}</b> {late === 1 ? 'has' : 'have'} been waiting over two weeks.</>}
        </p>
        <p className="status">{lastSeen ? <>Last updated from the portal {fmtDay(lastSeen)}.</> : 'No orders recorded yet. They appear after the next hourly check.'}</p>
      </section>

      <div className="order-seg-wrap">
        <nav className="seg order-seg" aria-label="Order stages">
          {TABS.map((t) => {
            const n = (counts as Record<string, number | undefined>)[t.key] ?? 0;
            const on = t.key === tab;
            return (
              <Link key={t.key} href={qs({ ...base, p: '' }, { stage: t.key === 'all' ? '' : t.key })} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
                {t.label}<span className="order-tab-n">{num(n)}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <form className="filters" method="get" action="/orders">
        {sp.stage && <input type="hidden" name="stage" value={sp.stage} />}
        <label className="select"><span>Placed in</span>
          <select name="month" defaultValue={sp.month ?? ''}>
            <option value="">Any month</option>
            {months.map((m) => <option key={m} value={m}>{monthText(m)}</option>)}
          </select>
        </label>
        <div className="search">
          <label htmlFor="order-q">Find an order or hostel</label>
          <div className="search-row">
            <span className="search-box"><Icon name="search" size={18} /><input id="order-q" name="q" defaultValue={sp.q ?? ''} placeholder="Request number or hostel name" autoComplete="off" /></span>
            <button className="btn primary-ish" type="submit">Search</button>
            {(sp.q || sp.month) && <Link href={qs({ stage: sp.stage ?? '' }, {})} className="link-arrow">Clear</Link>}
          </div>
        </div>
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
          <nav className="pager-bar" aria-label="Pages of orders">
            <span className="mut">Showing {num(offset + 1)} to {num(Math.min(offset + PAGE_SIZE, all.length))} of {num(all.length)}</span>
            <div className="pager-ctrl">
              {pageNo > 1
                ? <Link className="pager-btn" href={qs(base, { p: String(pageNo - 1) })} rel="prev"><Icon name="chevronLeft" size={16} /> Previous</Link>
                : <span className="pager-btn off" aria-disabled="true"><Icon name="chevronLeft" size={16} /> Previous</span>}
              <span className="pager-page">Page {pageNo} of {pages}</span>
              {pageNo < pages
                ? <Link className="pager-btn" href={qs(base, { p: String(pageNo + 1) })} rel="next">Next <Icon name="chevronRight" size={16} /></Link>
                : <span className="pager-btn off" aria-disabled="true">Next <Icon name="chevronRight" size={16} /></span>}
            </div>
          </nav>
          <p className="mut small">
            Days are counted from the date the portal gives for each stage. For cancelled and rejected orders the portal gives no date, so the count starts from when we first saw that status.
          </p>
        </>
      )}
    </div>
  );
}
