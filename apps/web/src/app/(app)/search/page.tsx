import Link from 'next/link';
import { STAGE_LABEL } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { scopeFor } from '@/lib/viewer';
import { hostelLabel } from '@/lib/format';
import { fmtDay } from '@/lib/orders';
import { searchDashboard, searchQuery, SEARCH_LIMIT } from '@/lib/search';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Search' };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = searchQuery((await searchParams).q);
  const c = await getDb();
  const { names } = await scopeFor(c);
  const results = q ? await searchDashboard(c, q, names) : null;
  return (
    <>
      <section className="hero">
        <h1>Find a hostel or order</h1>
        <p className="lede">Search by full or partial hostel name, hostel code, or request ID.</p>
      </section>
      <form action="/search" className="search" role="search" aria-label="Search results">
        <label htmlFor="results-query">Search stored records</label>
        <div className="search-row">
          <span className="search-box"><input id="results-query" name="q" type="search" defaultValue={q} maxLength={60} required /></span>
          <button className="btn primary-ish" type="submit">Search</button>
        </div>
      </form>
      {results && <>
        <p className="sub-lede search-summary" role="status">Results for “{q}”. {results.hostels.length}{results.moreHostels ? '+' : ''} hostels; {results.orders.length}{results.moreOrders ? '+' : ''} orders.</p>
        {!results.hostels.length && !results.orders.length && <div className="empty"><h2>No matching records</h2><p>Try a shorter name, hostel code, or a different request ID.</p></div>}
        {!!results.hostels.length && <section aria-labelledby="hostel-results">
          <h2 id="hostel-results" className="sub">Hostels</h2>
          <ul className="reqlist search-results">{results.hostels.map((h) => <li key={`${h.godownId}|${h.hostelCode}`}>
            <div><Link href={`/hostel/${encodeURIComponent(h.hostelCode)}?g=${h.godownId}`}>{hostelLabel(h.hostelName)}</Link><p className="mut small">Hostel {h.hostelCode} · {h.districtName} · {h.godownName}</p></div>
          </li>)}</ul>
          {results.moreHostels && <p className="mut small">Showing the first {SEARCH_LIMIT} hostels. Refine your search to find others.</p>}
        </section>}
        {!!results.orders.length && <section aria-labelledby="order-results">
          <h2 id="order-results" className="sub">Orders</h2>
          <div className="table-wrap"><table className="order-table">
            <thead><tr><th>Request ID</th><th>Hostel</th><th>District</th><th>Stage</th><th>Placed</th></tr></thead>
            <tbody>{results.orders.map((o) => <tr key={`${o.account}|${o.requestId}`}>
              <td><Link href={`/orders/${encodeURIComponent(o.requestId)}`}>{o.requestId}</Link></td>
              <td>{hostelLabel(o.hostelName)}<p className="mut small">{o.hostelCode}</p></td><td>{o.districtName}</td><td>{STAGE_LABEL[o.stage]}</td><td>{fmtDay(o.placedOn)}</td>
            </tr>)}</tbody>
          </table></div>
          {results.moreOrders && <p className="mut small">Showing the first {SEARCH_LIMIT} orders. <Link href={`/orders?q=${encodeURIComponent(q)}`}>See all matching orders</Link>.</p>}
        </section>}
      </>}
    </>
  );
}
