import Link from 'next/link';
import { getDb } from '@/lib/db';
import { hostelLabel, itemLabel, monthLabel, num } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Hostel({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ g?: string }> }) {
  const { code } = await params;
  const { g } = await searchParams;
  const c = await getDb();
  const filter = { hostelCode: code, ...(g ? { godownId: Number(g) } : {}) };
  const reqs = await c.requests.find(filter).toArray();
  if (!reqs.length) return <><Link className="back" href="/">Back to the list</Link><div className="empty">We could not find any requests for this hostel.</div></>;
  const flagged = await c.anomalies.find({ ...filter, status: { $nin: ['resolved', 'ignored', 'expected'] } }).toArray();

  const months = [...new Set(reqs.map((r) => r.month))].sort();
  const totals: Record<string, Record<string, number>> = {};
  for (const r of reqs) {
    if (/^reject/i.test(r.status)) continue;
    for (const [it, q] of Object.entries(r.items)) { const row = (totals[it] ??= {}); row[r.month] = (row[r.month] ?? 0) + q; }
  }
  const hit = new Set(flagged.map((a) => `${a.item}|${a.month}`));
  const flaggedItems = new Set(flagged.map((a) => a.item));
  const items = Object.keys(totals).filter((it) => Object.values(totals[it]!).some((q) => q > 0))
    .sort((a, b) => Number(flaggedItems.has(b)) - Number(flaggedItems.has(a)) || a.localeCompare(b));
  const cols = { '--cols': months.length } as React.CSSProperties;

  return (
    <>
      <Link className="back" href="/">Back to the list</Link>
      <div className="hero">
        <h1>{hostelLabel(reqs[0]!.hostelName)}</h1>
        <p>{reqs[0]!.districtName} district. Here is everything this hostel asked for, month by month. Numbers shaded red looked much bigger than usual.</p>
      </div>
      <div className="grid" role="table" aria-label="Quantities requested each month">
        <div className="grid-row" style={cols} role="row"><span>Item</span>{months.map((m) => <span className="c" key={m}>{monthLabel(m, true)}</span>)}</div>
        {items.map((it) => (
          <div className="grid-row" style={cols} key={it} role="row">
            <span>{itemLabel(it)}</span>
            {months.map((m) => <span key={m} className="c"><span className={hit.has(`${it}|${m}`) ? 'hit' : ''}>{num(totals[it]![m] ?? 0)}</span></span>)}
          </div>
        ))}
      </div>
      <p className="legend">Rejected requests are not counted.</p>
      <h2 className="sub">Each request</h2>
      <ul className="reqlist">
        {[...reqs].sort((a, b) => b.requestDate.localeCompare(a.requestDate)).map((r) => (
          <li key={r.requestId}><span>{r.requestDate} for {monthLabel(r.month)}</span><span className="mut">{r.status.replace(/_/g, ' ')}</span></li>
        ))}
      </ul>
    </>
  );
}
