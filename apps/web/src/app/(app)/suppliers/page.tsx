import Link from 'next/link';
import { getDb } from '@/lib/db';
import { num } from '@/lib/format';
import { MEETING, BYS, VERDICT_TEXT, type PerfRow } from '@/lib/performance';
import { loadPerformanceView } from '@/lib/performance-view';
import { orderMonths } from '@/lib/orders';
import { scopeFor } from '@/lib/viewer';
import { Icon } from '@/components/Icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Supplier performance' };

type SP = { by?: string; month?: string; focus?: string };
const monthText = (ym: string) => new Date(`${ym}-01T12:00:00+05:30`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const dayAvg = (x: number | null) => (x === null ? '—' : x.toFixed(1));
const qs = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
const verdictClass = (v: PerfRow['verdict']) => (v === 'not_meeting' ? 'late' : v === 'watch' ? 'watch' : '');

function Table({ rows, overall, by, month, linkRow }: { rows: PerfRow[]; overall?: PerfRow; by: string; month?: string; linkRow?: (r: PerfRow) => string | null }) {
  return (
    <div className="table-wrap"><table className="order-table dash-table perf-table">
      <thead><tr>
        <th>S.No</th><th>{by === 'supplier' ? 'Supplier' : by === 'godown' ? 'Godown' : by === 'district' ? 'District' : 'Hostel'}</th>
        <th className="num">Orders</th><th className="num">Supplied (of what was asked)</th><th className="num">Received (of what was supplied)</th>
        <th className="num">Days to DC</th><th className="num">Days DC to dispatch</th><th className="num">Days dispatch to acknowledge</th>
        <th className="num">Open orders</th><th className="num">Open 7+ days</th><th className="num">Open 15+ days</th>
        <th className="num">Rejected</th><th className="num">With variation</th><th className="num">Against average</th><th>Meeting demand?</th>
      </tr></thead>
      <tbody>{rows.map((r, i) => {
        const href = linkRow?.(r);
        const ordersHref = r.filter.hostel ? `/hostel/${encodeURIComponent(r.filter.hostel)}` : (r.filter.district || r.filter.account) ? `/orders?${qs({ ...r.filter, month })}` : null;
        return (
          <tr key={r.key}>
            <td>{i + 1}</td><td><b>{href ? <Link href={href}>{r.label}</Link> : r.label}</b></td>
            <td className="num">{ordersHref ? <Link href={ordersHref}>{num(r.orders)}</Link> : num(r.orders)}<div className="mut small">{r.read} read</div></td>
            <td className="num">{pct(r.fill)}</td><td className="num">{pct(r.receivedFill)}</td>
            <td className="num">{dayAvg(r.daysToDc)}</td><td className="num">{dayAvg(r.daysDcToDispatch)}</td><td className="num">{dayAvg(r.daysToAcknowledge)}</td>
            <td className="num">{num(r.backlog)}</td><td className={`num ${r.backlog7 ? 'watch' : ''}`}>{r.backlog7 ? num(r.backlog7) : '—'}</td><td className={`num ${r.backlog15 ? 'late' : ''}`}>{r.backlog15 ? num(r.backlog15) : '—'}</td>
            <td className="num">{pct(r.rejectedShare)}</td><td className="num">{pct(r.variationShare)}</td>
            <td className="num">{r.vsAverage === null ? '—' : `${r.vsAverage >= 0 ? '+' : '−'}${Math.abs(r.vsAverage).toFixed(0)} pts`}</td>
            <td className={verdictClass(r.verdict)}><b>{VERDICT_TEXT[r.verdict]}</b></td>
          </tr>
        );
      })}</tbody>
      {overall && <tfoot><tr><td /><td><b>All in view</b></td><td className="num">{num(overall.orders)}</td><td className="num">{pct(overall.fill)}</td><td className="num">{pct(overall.receivedFill)}</td><td className="num">{dayAvg(overall.daysToDc)}</td><td className="num">{dayAvg(overall.daysDcToDispatch)}</td><td className="num">{dayAvg(overall.daysToAcknowledge)}</td><td className="num">{num(overall.backlog)}</td><td className="num">{num(overall.backlog7)}</td><td className="num">{num(overall.backlog15)}</td><td className="num">{pct(overall.rejectedShare)}</td><td className="num">{pct(overall.variationShare)}</td><td /><td /></tr></tfoot>}
    </table></div>
  );
}

export default async function Suppliers({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const c = await getDb();
  const { names } = await scopeFor(c);
  const [v, months] = await Promise.all([loadPerformanceView(c, names, sp), orderMonths(c, names)]);
  const here = (o: Record<string, string | undefined>) => `/suppliers?${qs({ by: v.by, month: v.month, ...o })}`;
  const focusLabel = v.focus ? v.main.rows[0]?.label ?? v.focus : null;
  const rowLink = (r: PerfRow) => (v.by === 'hostel' ? null : here({ focus: r.key }));

  return (
    <>
      <section className="hero">
        <p className="greet">Supplier performance</p>
        <h1>{v.focus ? focusLabel : v.by === 'hostel' ? 'How each hostel is being served' : 'Are suppliers meeting demand?'}</h1>
        <p className="lede">
          {v.focus
            ? <>The {num(v.total)} orders behind this row. <Link href={here({ focus: undefined })} className="link-arrow">Back to all</Link></>
            : 'Each supplier’s share of what hostels asked for that was actually supplied, how quickly, and how many orders are still waiting. The weakest are at the top.'}
        </p>
        {!v.mapped && v.by === 'supplier' && <p className="status bad" role="status">No district-to-supplier mapping has been imported yet, so orders cannot be given to a supplier. Import the mapping under Master data. Meanwhile use the Godown or District view.</p>}
        <p className="mut small">Quantities have been read for {num(v.coverage.read)} of {num(v.coverage.withDc)} orders that have a delivery note. The rest are read a few every hour, so the figures sharpen over the first day.</p>
      </section>

      <div className="order-seg-wrap">
        <nav className="seg order-seg" aria-label="Views">
          {BYS.map((b) => <Link key={b.key} href={`/suppliers?${qs({ by: b.key, month: v.month })}`} className={b.key === v.by ? 'on' : ''} aria-current={b.key === v.by ? 'page' : undefined}>{b.label}</Link>)}
        </nav>
      </div>
      <form className="filters" method="get" action="/suppliers">
        <input type="hidden" name="by" value={v.by} />{v.focus && <input type="hidden" name="focus" value={v.focus} />}
        <label className="select"><span>Placed in</span>
          <select name="month" defaultValue={v.month ?? ''}><option value="">Any month</option>{months.map((m) => <option key={m} value={m}>{monthText(m)}</option>)}</select>
        </label>
        <button className="btn primary-ish" type="submit">Show</button>
        <a className="btn" href={`/suppliers/csv?${qs({ by: v.by, month: v.month, focus: v.focus })}`}><Icon name="download" size={16} /> Download Excel</a>
      </form>

      {v.main.rows.length === 0 ? <div className="empty">No orders match these choices.</div> : (
        <Table rows={v.main.rows} overall={v.main.overall} by={v.by} month={v.month} linkRow={v.focus ? () => null : rowLink} />
      )}

      {v.sub && (
        <>
          <h2 className="sub">Hostels given to this {v.by === 'supplier' ? 'supplier' : v.by}</h2>
          <p className="lede small">Out of {num(v.sub.service.served + v.sub.service.short + v.sub.service.waiting)} hostels with orders: <b>{num(v.sub.service.served)}</b> were served in full (90%+ of what they asked for), <b>{num(v.sub.service.short)}</b> were short, and <b>{num(v.sub.service.waiting)}</b> are still waiting for supplies to be recorded.</p>
          <h3 className="sub-h">Districts, weakest first</h3>
          <Table rows={v.sub.districts} by="district" month={v.month} />
          <h3 className="sub-h">Weakest hostels (15 shown)</h3>
          <Table rows={v.sub.weakestHostels} by="hostel" month={v.month} />
        </>
      )}

      {v.checkpoint && v.checkpoint.rows.length > 0 && (
        <section aria-labelledby="checkpoint">
          <h2 className="sub" id="checkpoint">Meeting demand, month by month</h2>
          <p className="lede small">Each cell is the supplied share and the verdict for orders placed that month.</p>
          <div className="table-wrap"><table className="order-table dash-table">
            <thead><tr><th>Supplier</th>{v.checkpoint.months.map((m) => <th key={m} className="num">{monthText(m)}</th>)}</tr></thead>
            <tbody>{v.checkpoint.rows.map((r) => <tr key={r.key}><td><b>{r.label}</b></td>{v.checkpoint!.months.map((m) => { const x = r.months[m]; return <td key={m} className={`num ${x ? verdictClass(x.verdict) : ''}`}>{x ? <><b>{VERDICT_TEXT[x.verdict]}</b><div className="small">{pct(x.fill)} supplied · {x.orders} orders{x.backlog15 ? ` · ${x.backlog15} open 15+ days` : ''}</div></> : '—'}</td>; })}</tr>)}</tbody>
          </table></div>
        </section>
      )}

      <section className="summary" aria-labelledby="how">
        <h2 id="how">How to read this</h2>
        <ul>
          <li><b>Supplied</b> compares each item with itself (what the godown supplied against what the hostel asked for) and averages the items. Different units are never added together.</li>
          <li><b>Meeting demand</b>: at least {MEETING.fill * 100}% supplied and no more than {MEETING.lateShare * 100}% of open orders waiting 15+ days. <b>Not meeting demand</b>: under {MEETING.notFill * 100}% supplied, or more than {MEETING.notLateShare * 100}% of open orders waiting 15+ days. Anything between is <b>Watch</b>.</li>
          <li><b>Against average</b> is the difference in supplied share from all orders in view, in percentage points.</li>
          <li>Days use the portal’s own dates (whole days). Orders still Pending have not been supplied yet, so they are not counted as short.</li>
        </ul>
      </section>
    </>
  );
}
