import Link from 'next/link';
import { getDb } from '@/lib/db';
import { hostelLabel, num } from '@/lib/format';
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

/** One card per supplier / godown / district / hostel. Every card has the same size; the figure is how much of what was asked was sent. */
function PerfCard({ r, by, month, focusHref }: { r: PerfRow; by: By; month?: string; focusHref: string | null }) {
  const ordersHref = r.filter.hostel ? `/orders?${qs({ q: r.filter.hostel, month })}` : (r.filter.district || r.filter.account) ? `/orders?${qs({ ...r.filter, month })}` : null;
  const fill = r.fill === null ? null : Math.round(r.fill * 100);
  return (
    <article className={`pcard v-${r.verdict}`}>
      <div className="pc-top">
        <h3 className="pc-name">{focusHref ? <Link href={focusHref}>{r.filter.hostel ? hostelLabel(r.label) : r.label}</Link> : r.filter.hostel ? hostelLabel(r.label) : r.label}</h3>
        <span className={`verdict-chip ${r.verdict}`}>{VERDICT_TEXT[r.verdict]}</span>
      </div>
      <div className="pc-body">
        {fill === null ? (
          <p className="pc-none">Not enough information yet.</p>
        ) : (
          <>
            <div className="pc-fig"><b>{fill}%</b><small>of what was asked was sent</small></div>
            <div className="pc-meter" role="img" aria-label={`${fill}% sent`}><i style={{ width: `${fill}%` }} /></div>
          </>
        )}
      </div>
      <div className="pc-foot">
        <span><b className={r.backlog15 ? 'late' : ''}>{num(r.backlog15)}</b> waiting over 2 weeks</span>
        <span><b>{num(r.orders)}</b> orders</span>
        <span className="pc-links">
          {ordersHref && <Link href={ordersHref} className="link-arrow">Orders<Icon name="arrow" size={14} /></Link>}
          {focusHref && by !== 'hostel' && <Link href={focusHref} className="link-arrow">Details<Icon name="arrow" size={14} /></Link>}
        </span>
      </div>
    </article>
  );
}

/** The districts inside one supplier, and the weakest hostels: the same cards. */
function PerfCards({ rows, month }: { rows: PerfRow[]; month?: string }) {
  return (
    <div className="perf-cards pc-grid">
      {rows.map((r) => <PerfCard key={r.key} r={r} by={r.filter.hostel ? 'hostel' : 'district'} month={month} focusHref={null} />)}
    </div>
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
        <div className="perf-cards pc-grid">{v.main.rows.map((r) => <PerfCard key={r.key} r={r} by={v.by} month={v.month} focusHref={here({ focus: r.key })} />)}</div>
      ) : v.focus ? (
        <div className="perf-cards pc-grid"><PerfCard r={v.main.rows[0]!} by={v.by} month={v.month} focusHref={null} /></div>
      ) : (
        <PerfCards rows={v.main.rows} month={v.month} />
      )}

      {v.sub && (
        <>
          <h2 className="sub">Hostels under this {WHO[v.by].one}</h2>
          <p className="lede small">Out of {num(v.sub.service.served + v.sub.service.short + v.sub.service.waiting)} hostels with orders: <b>{num(v.sub.service.served)}</b> were fully served (90% or more of what they asked for was sent), <b>{num(v.sub.service.short)}</b> were short, and <b>{num(v.sub.service.waiting)}</b> have no delivery quantities recorded yet.</p>
          <h3 className="sub-h">Districts, weakest first</h3>
          <PerfCards rows={v.sub.districts} month={v.month} />
          <h3 className="sub-h">The 15 hostels furthest behind</h3>
          <PerfCards rows={v.sub.weakestHostels} month={v.month} />
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
