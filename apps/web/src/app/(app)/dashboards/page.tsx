import Link from 'next/link';
import { STAGE_LABEL } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { num } from '@/lib/format';
import { godownLabels, loadSummaryOrders, stageSummary, summarize, SUMMARY_STAGES, VIEWS, type View } from '@/lib/dashboard';
import { orderMonths, STUCK_DAYS } from '@/lib/orders';
import { scopeFor } from '@/lib/viewer';
import { Icon } from '@/components/Icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboards' };

type SP = { view?: string; month?: string };
const monthText = (ym: string) => new Date(`${ym}-01T12:00:00+05:30`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
const orders = (q: Record<string, string | undefined>) => `/orders?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`;

export default async function Dashboards({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view = (VIEWS.find((v) => v.key === sp.view)?.key ?? 'overall') as View;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month : undefined;
  const c = await getDb();
  const { names } = await scopeFor(c);
  const now = new Date();
  const [rows, months, label] = await Promise.all([loadSummaryOrders(c, names, month), orderMonths(c, names), godownLabels(c)]);
  const exportHref = `/dashboards/csv?${new URLSearchParams({ view, ...(month ? { month } : {}) })}`;
  const stages = stageSummary(rows, now);
  const matrix = view === 'overall' ? [] : summarize(rows, view, now, label);
  const q = (patch: Record<string, string>) => `/dashboards?${new URLSearchParams({ view, ...(month ? { month } : {}), ...patch })}`;

  return (
    <>
      <section className="hero">
        <p className="greet">Dashboards</p>
        <h1>{num(rows.length)} orders{month ? ` placed in ${monthText(month)}` : ''}</h1>
        <p className="lede">How many orders are at each stage, and which are stuck. Days are counted only while an order is Pending, DC Generated, In-Transit or in Variation. “7+ days” and “15+ days” count orders that have stayed at their current stage that long. Click any number to see those orders.</p>
      </section>

      <div className="order-seg-wrap">
        <nav className="seg order-seg" aria-label="Dashboard views">
          {VIEWS.map((v) => <Link key={v.key} href={`/dashboards?${new URLSearchParams({ view: v.key, ...(month ? { month } : {}) })}`} className={v.key === view ? 'on' : ''} aria-current={v.key === view ? 'page' : undefined}>{v.label}</Link>)}
        </nav>
      </div>

      <form className="filters" method="get" action="/dashboards">
        <input type="hidden" name="view" value={view} />
        <label className="select"><span>Placed in</span>
          <select name="month" defaultValue={month ?? ''}>
            <option value="">Any month</option>
            {months.map((m) => <option key={m} value={m}>{monthText(m)}</option>)}
          </select>
        </label>
        <button className="btn primary-ish" type="submit">Show</button>
        {month && <Link href={q({}).replace(/&?month=[^&]*/, '')} className="link-arrow">Clear</Link>}
        <a className="btn" href={exportHref}><Icon name="download" size={16} /> Download Excel</a>
      </form>

      {rows.length === 0 ? <div className="empty">No orders match these choices.</div> : view === 'overall' ? (
        <div className="table-wrap"><table className="order-table dash-table">
          <caption className="sr-only">Orders by stage</caption>
          <thead><tr><th>S.No</th><th>Stage</th><th className="num">Orders</th><th className="num">Hostels</th><th className="num">{STUCK_DAYS[0]}+ days</th><th className="num">{STUCK_DAYS[1]}+ days</th></tr></thead>
          <tbody>
            {stages.rows.map((r, i) => (
              <tr key={r.stage}>
                <td>{i + 1}</td><td><b>{r.label}</b></td>
                <td className="num">{r.orders ? <Link href={orders({ stage: r.stage, month })}>{num(r.orders)}</Link> : '0'}</td>
                <td className="num">{num(r.hostels)}</td>
                <td className={`num ${r.stuck7 ? 'watch' : ''}`}>{r.stuck7 ? <Link href={orders({ stage: r.stage, month, stuck: String(STUCK_DAYS[0]) })}>{num(r.stuck7)}</Link> : '—'}</td>
                <td className={`num ${r.stuck15 ? 'late' : ''}`}>{r.stuck15 ? <Link href={orders({ stage: r.stage, month, stuck: String(STUCK_DAYS[1]) })}>{num(r.stuck15)}</Link> : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td /><td><b>All orders</b></td><td className="num"><b><Link href={orders({ month })}>{num(stages.total)}</Link></b></td><td /><td className="num">{num(stages.rows.reduce((s, r) => s + r.stuck7, 0))}</td><td className="num">{num(stages.rows.reduce((s, r) => s + r.stuck15, 0))}</td></tr></tfoot>
        </table></div>
      ) : (
        <div className="table-wrap"><table className="order-table dash-table">
          <caption className="sr-only">Orders by {view === 'district' ? 'district' : 'godown'} and stage</caption>
          <thead><tr>
            <th>S.No</th><th>{view === 'district' ? 'District' : 'Godown'}</th><th className="num">Hostels</th>
            {SUMMARY_STAGES.map((s) => <th key={s} className="num">{STAGE_LABEL[s]}</th>)}
            <th className="num">Total</th><th className="num">{STUCK_DAYS[0]}+ days</th><th className="num">{STUCK_DAYS[1]}+ days</th>
          </tr></thead>
          <tbody>
            {matrix.map((r, i) => (
              <tr key={r.key}>
                <td>{i + 1}</td><td><b><Link href={orders({ ...r.filter, month })}>{r.label}</Link></b></td><td className="num">{num(r.hostels)}</td>
                {SUMMARY_STAGES.map((s) => <td key={s} className="num">{r.byStage[s] ? <Link href={orders({ ...r.filter, stage: s, month })}>{num(r.byStage[s])}</Link> : <span className="mut">0</span>}</td>)}
                <td className="num"><b>{num(r.total)}</b></td>
                <td className={`num ${r.stuck7 ? 'watch' : ''}`}>{r.stuck7 ? <Link href={orders({ ...r.filter, month, stuck: String(STUCK_DAYS[0]) })}>{num(r.stuck7)}</Link> : '—'}</td>
                <td className={`num ${r.stuck15 ? 'late' : ''}`}>{r.stuck15 ? <Link href={orders({ ...r.filter, month, stuck: String(STUCK_DAYS[1]) })}>{num(r.stuck15)}</Link> : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td /><td><b>All</b></td><td />
            {SUMMARY_STAGES.map((s) => <td key={s} className="num">{num(matrix.reduce((n, r) => n + r.byStage[s], 0))}</td>)}
            <td className="num"><b>{num(matrix.reduce((n, r) => n + r.total, 0))}</b></td>
            <td className="num">{num(matrix.reduce((n, r) => n + r.stuck7, 0))}</td><td className="num">{num(matrix.reduce((n, r) => n + r.stuck15, 0))}</td>
          </tr></tfoot>
        </table></div>
      )}
      <p className="mut small">“Hostels” counts hostels that have at least one order here. The totals are the same numbers as the tabs on Order tracking. A hostel with orders at different stages is counted in each of those stages.</p>
    </>
  );
}
