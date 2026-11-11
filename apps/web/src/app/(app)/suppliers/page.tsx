import Link from 'next/link';
import { getDb } from '@/lib/db';
import { num } from '@/lib/format';
import { MEETING, BYS, VERDICT_TEXT, type By, type PerfRow } from '@/lib/performance';
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

const WHO: Record<By, { title: string; one: string }> = {
  supplier: { title: 'How well is each supplier delivering?', one: 'supplier' },
  godown: { title: 'How well is each godown delivering?', one: 'godown' },
  district: { title: 'How well is each district being served?', one: 'district' },
  hostel: { title: 'How well is each hostel being served?', one: 'hostel' },
};
const TAB_LABEL: Record<By, string> = { supplier: 'By supplier', godown: 'By godown', district: 'By district', hostel: 'By hostel' };

/** One card per supplier / godown / district: the first number is how much of what hostels asked for was actually sent. */
function GroupCard({ r, by, month, focusHref }: { r: PerfRow; by: By; month?: string; focusHref: string | null }) {
  const ordersHref = r.filter.hostel ? `/hostel/${encodeURIComponent(r.filter.hostel)}` : (r.filter.district || r.filter.account) ? `/orders?${qs({ ...r.filter, month })}` : null;
  const fill = r.fill === null ? null : Math.round(r.fill * 100);
  return (
    <article className={`perf-card v-${r.verdict}`}>
      <header>
        <h3>{focusHref ? <Link href={focusHref}>{r.label}</Link> : r.label}</h3>
        <span className={`verdict-chip ${r.verdict}`}>{VERDICT_TEXT[r.verdict]}</span>
      </header>
      {fill === null ? (
        <p className="perf-none">Not enough information yet. {num(r.orders)} orders.</p>
      ) : (
        <div className="perf-main">
          <div className="perf-big"><b>{fill}%</b><span>of what was asked was sent</span></div>
          <div className="perf-meter" role="img" aria-label={`${fill}% sent`}><i style={{ width: `${fill}%` }} /></div>
        </div>
      )}
      <div className="perf-line">
        <span><b className={r.backlog15 ? 'late' : ''}>{num(r.backlog15)}</b> waiting over 2 weeks</span>
        <span><b>{num(r.orders)}</b> orders</span>
        {ordersHref && <Link href={ordersHref} className="link-arrow">Orders<Icon name="arrow" size={14} /></Link>}
        {focusHref && by !== 'hostel' && <Link href={focusHref} className="link-arrow">Details<Icon name="arrow" size={14} /></Link>}
      </div>
    </article>
  );
}

/** A compact list for the many rows (hostels, or the districts inside one supplier). */
function Rows({ rows, by, month }: { rows: PerfRow[]; by: By; month?: string }) {
  return (
    <div className="table-wrap"><table className="order-table dash-table perf-table">
      <thead><tr>
        <th>{by === 'district' ? 'District' : 'Hostel'}</th>
        <th className="num" title="How many orders; in brackets, the orders whose quantities are known">Orders</th>
        <th className="num" title="Of everything the hostels asked for, how much was sent">Sent</th>
        <th className="num" title="Of what was sent, how much reached the hostel">Reached</th>
        <th className="num" title="Not yet acknowledged and the same stage for 7 days or more">Waiting 7+ days</th>
        <th className="num" title="Not yet acknowledged and the same stage for 15 days or more">Waiting 15+ days</th>
        <th className="num">Rejected</th>
        <th>Verdict</th>
      </tr></thead>
      <tbody>{rows.map((r) => {
        const href = r.filter.hostel ? `/hostel/${encodeURIComponent(r.filter.hostel)}` : (r.filter.district || r.filter.account) ? `/orders?${qs({ ...r.filter, month })}` : null;
        return (
          <tr key={r.key}>
            <td><b>{href ? <Link href={href}>{r.label}</Link> : r.label}</b></td>
            <td className="num">{num(r.orders)} <span className="mut small">({num(r.read)})</span></td>
            <td className="num"><b>{pct(r.fill)}</b></td><td className="num">{pct(r.receivedFill)}</td>
            <td className={`num ${r.backlog7 ? 'watch' : ''}`}>{r.backlog7 ? num(r.backlog7) : '—'}</td><td className={`num ${r.backlog15 ? 'late' : ''}`}>{r.backlog15 ? num(r.backlog15) : '—'}</td>
            <td className="num">{pct(r.rejectedShare)}</td>
            <td><span className={`verdict-chip ${r.verdict}`}>{VERDICT_TEXT[r.verdict]}</span></td>
          </tr>
        );
      })}</tbody>
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
  const cards = v.by !== 'hostel' && !v.focus;
  const o = v.main.overall;

  return (
    <>
      <section className="hero">
        <p className="greet">Supplier performance</p>
        <h1>{v.focus ? focusLabel : WHO[v.by].title}</h1>
        <p className="lede">{v.focus ? <>The {num(v.total)} orders behind this {WHO[v.by].one}. <Link href={here({ focus: undefined })} className="link-arrow">Back to all</Link></> : 'Weakest first.'}</p>
        {v.by === 'supplier' && v.main.rows.some((r) => r.key === '(unmapped)') && <p className="mut small">“No supplier mapped yet” = orders still Pending; the portal names the supplier once a delivery note exists.</p>}
      </section>

      <div className="order-seg-wrap">
        <nav className="seg order-seg" aria-label="Group by">
          {BYS.map((b) => <Link key={b.key} href={`/suppliers?${qs({ by: b.key, month: v.month })}`} className={b.key === v.by ? 'on' : ''} aria-current={b.key === v.by ? 'page' : undefined}>{TAB_LABEL[b.key]}</Link>)}
        </nav>
      </div>
      <form className="filters" method="get" action="/suppliers">
        <input type="hidden" name="by" value={v.by} />{v.focus && <input type="hidden" name="focus" value={v.focus} />}
        <label className="select"><span>Orders placed in</span>
          <select name="month" defaultValue={v.month ?? ''}><option value="">Any month</option>{months.map((m) => <option key={m} value={m}>{monthText(m)}</option>)}</select>
        </label>
        <button className="btn primary-ish" type="submit">Show</button>
        <a className="btn" href={`/suppliers/csv?${qs({ by: v.by, month: v.month, focus: v.focus })}`}><Icon name="download" size={16} /> Download Excel</a>
      </form>

      {v.main.rows.length === 0 ? <div className="empty">No orders match these choices.</div> : cards ? (
        <div className="perf-cards">{v.main.rows.map((r) => <GroupCard key={r.key} r={r} by={v.by} month={v.month} focusHref={here({ focus: r.key })} />)}</div>
      ) : v.focus ? (
        <GroupCard r={v.main.rows[0]!} by={v.by} month={v.month} focusHref={null} />
      ) : (
        <Rows rows={v.main.rows} by={v.by} month={v.month} />
      )}

      {v.sub && (
        <>
          <h2 className="sub">Hostels under this {WHO[v.by].one}</h2>
          <p className="lede small">Out of {num(v.sub.service.served + v.sub.service.short + v.sub.service.waiting)} hostels with orders: <b>{num(v.sub.service.served)}</b> were fully served (90% or more of what they asked for was sent), <b>{num(v.sub.service.short)}</b> were short, and <b>{num(v.sub.service.waiting)}</b> have no delivery quantities recorded yet.</p>
          <h3 className="sub-h">Districts, weakest first</h3>
          <Rows rows={v.sub.districts} by="district" month={v.month} />
          <h3 className="sub-h">The 15 hostels furthest behind</h3>
          <Rows rows={v.sub.weakestHostels} by="hostel" month={v.month} />
        </>
      )}

      <details className="summary how">
        <summary><h2>How are these numbers worked out?</h2></summary>
        <ol>
          <li>For each item in an order, the portal gives the amount the hostel <b>asked for</b> and the amount the godown <b>sent</b>. We divide sent by asked (never more than 100%).</li>
          <li>The items of one order are averaged to give that order a score. The orders are then averaged to give the supplier, godown, district or hostel its score. Different units (kg, packets) are never added together.</li>
          <li>Only orders that already have a delivery note and known quantities count. Orders still Pending have not been sent yet, so they are never counted as short. Rejected and cancelled orders are left out of the score.</li>
          <li><b>Waiting</b> means the order has not been acknowledged and has stayed at the same stage for that many days.</li>
          <li><b>On track</b>: at least {MEETING.fill * 100}% sent and no more than {MEETING.lateShare * 100}% of waiting orders over two weeks. <b>Falling short</b>: under {MEETING.notFill * 100}% sent, or more than {MEETING.notLateShare * 100}% of waiting orders over two weeks. Anything in between: <b>Needs attention</b>.</li>
        </ol>
      </details>
    </>
  );
}
