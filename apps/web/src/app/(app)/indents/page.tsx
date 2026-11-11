import Link from 'next/link';
import { scoped, STAGE_LABEL } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { scopeFor } from '@/lib/viewer';
import { hostelLabel, monthLabel, num } from '@/lib/format';
import { orderFilter, orderMonth, orderMonths, TABS } from '@/lib/orders';
import { searchQuery } from '@/lib/search';
import { Icon } from '@/components/Icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Indents' };
const PAGE_SIZE = 12;

type SP = { q?: string; month?: string; district?: string; stage?: string; flagged?: string; p?: string };
const qs = (cur: SP, patch: Partial<SP>) => `/indents?${new URLSearchParams(Object.entries({ ...cur, ...patch }).filter(([, v]) => v) as [string, string][])}`;

export default async function Indents({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const c = await getDb();
  const { names } = await scopeFor(c);
  const q = searchQuery(sp.q);
  const base: Record<string, unknown> = orderFilter({ q, month: sp.month, district: sp.district, stage: sp.stage });
  const flagged = sp.flagged === '1';
  if (flagged) {
    // indents whose hostel and month have an open unusual-request flag (the same rule the indent page uses)
    const flags = await c.anomalies.find(scoped({ status: 'open', severity: { $in: ['high', 'medium'] }, partOfOrder: { $ne: true } }, names), { projection: { hostelCode: 1, month: 1 } }).limit(3000).toArray();
    const keys = new Set(flags.map((f) => `${f.hostelCode}|${f.month}`));
    const reqs = keys.size ? await c.requests.find(scoped({ hostelCode: { $in: [...new Set(flags.map((f) => f.hostelCode))] }, month: { $in: [...new Set(flags.map((f) => f.month))] } }, names), { projection: { requestId: 1, hostelCode: 1, month: 1 } }).limit(6000).toArray() : [];
    base.requestId = { $in: reqs.filter((r) => keys.has(`${r.hostelCode}|${r.month}`)).map((r) => r.requestId) };
  }
  const filter = scoped(base, names);
  const total = await c.orders.countDocuments(filter as never);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE)), page = Math.min(pages, Math.max(1, Number(sp.p) || 1));
  const [rows, months, districts] = await Promise.all([
    c.orders.find(filter as never).sort({ placedOn: -1, requestId: 1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray(),
    orderMonths(c, names), c.orders.distinct('districtName', scoped({}, names)),
  ]);
  const [reqs, flagRows] = await Promise.all([
    c.requests.find({ requestId: { $in: rows.map((r) => r.requestId) } }, { projection: { requestId: 1, items: 1 } }).toArray(),
    rows.length ? c.anomalies.find(scoped({ hostelCode: { $in: rows.map((r) => r.hostelCode) }, status: 'open', severity: { $in: ['high', 'medium'] }, partOfOrder: { $ne: true } }, names), { projection: { hostelCode: 1, month: 1, item: 1 } }).toArray() : [],
  ]);
  const itemCount = new Map(reqs.map((r) => [r.requestId, Object.values(r.items ?? {}).filter((x) => x > 0).length]));
  const flagCount = (code: string, month: string) => flagRows.filter((f) => f.hostelCode === code && f.month === month).length;
  const monthText = (ym: string) => monthLabel(ym);

  return (
    <>
      <section className="hero">
        <h1>Indents</h1>
        <p className="lede">Every indent (request) with its items. Open one to see exactly what was asked for.</p>
      </section>
      <form className="filters" method="get" action="/indents">
        <label className="select"><span>Find an indent</span><span className="search-box"><Icon name="search" size={18} /><input name="q" defaultValue={q} placeholder="Hostel name, hostel ID or request ID" autoComplete="off" /></span></label>
        <label className="select"><span>Month</span><select name="month" defaultValue={sp.month ?? ''}><option value="">Any month</option>{months.map((m) => <option key={m} value={m}>{monthText(m)}</option>)}</select></label>
        {districts.length > 1 && <label className="select"><span>District</span><select name="district" defaultValue={sp.district ?? ''}><option value="">All districts</option>{[...districts].sort().map((d) => <option key={d} value={d}>{d}</option>)}</select></label>}
        <label className="select"><span>Stage</span><select name="stage" defaultValue={sp.stage ?? ''}>{TABS.map((t) => <option key={t.key} value={t.key === 'all' ? '' : t.key}>{t.label}</option>)}</select></label>
        <label className="check"><input type="checkbox" name="flagged" value="1" defaultChecked={flagged} /> Only with unusual requests</label>
        <button className="btn primary-ish" type="submit">Show</button>
        {(q || sp.month || sp.district || sp.stage || flagged) && <Link href="/indents" className="link-arrow">Clear</Link>}
      </form>
      <p className="mut small">{num(total)} indent{total === 1 ? '' : 's'}</p>
      {rows.length === 0 ? <div className="empty">No indents match these choices.</div> : (
        <div className="table-wrap"><table className="order-table">
          <thead><tr><th>Request</th><th>Hostel</th><th>Month</th><th>Stage</th><th className="num">Items</th><th className="num">Unusual</th></tr></thead>
          <tbody>{rows.map((r) => {
            const month = orderMonth(r.placedOn), fc = flagCount(r.hostelCode, month);
            return (
              <tr key={r.requestId}>
                <td><Link href={`/indents/${encodeURIComponent(r.requestId)}`}><b>{r.requestId}</b></Link></td>
                <td>{hostelLabel(r.hostelName)}<div className="mut small">{r.districtName} · Hostel ID {r.hostelCode}</div></td>
                <td>{month ? monthLabel(month) : '—'}</td>
                <td><span className={`stage-chip st-${r.stage}`}>{STAGE_LABEL[r.stage]}</span></td>
                <td className="num">{num(itemCount.get(r.requestId) ?? 0)}</td>
                <td className="num">{fc > 0 ? <b className="bad-text">{num(fc)}</b> : '—'}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {pages > 1 && (
        <nav className="pager-bar" aria-label="Pages of indents">
          <span className="mut">Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {num(total)}</span>
          <div className="pager-ctrl">
            {page > 1 ? <Link className="pager-btn" href={qs(sp, { p: String(page - 1) })}><Icon name="chevronLeft" size={16} /> Previous</Link> : <span className="pager-btn off"><Icon name="chevronLeft" size={16} /> Previous</span>}
            <span className="pager-page">Page {page} of {pages}</span>
            {page < pages ? <Link className="pager-btn" href={qs(sp, { p: String(page + 1) })}>Next <Icon name="chevronRight" size={16} /></Link> : <span className="pager-btn off">Next <Icon name="chevronRight" size={16} /></span>}
          </div>
        </nav>
      )}
    </>
  );
}
