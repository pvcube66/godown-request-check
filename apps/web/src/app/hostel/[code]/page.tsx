import Link from 'next/link';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Hostel({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ g?: string }> }) {
  const { code } = await params;
  const { g } = await searchParams;
  const c = await getDb();
  const filter = { hostelCode: code, ...(g ? { godownId: Number(g) } : {}) };
  const reqs = await c.requests.find(filter).toArray();
  const flagged = await c.anomalies.find({ ...filter, status: { $ne: 'resolved' } }).toArray();
  if (!reqs.length) return <p>No requests found for hostel {code}. <Link href="/">Back</Link></p>;

  const months = [...new Set(reqs.map((r) => r.month))].sort();
  const totals: Record<string, Record<string, number>> = {};          // item -> month -> qty (rejected ignored)
  for (const r of reqs) {
    if (/^reject/i.test(r.status)) continue;
    for (const [it, q] of Object.entries(r.items)) { (totals[it] ??= {})[r.month] = ((totals[it] ??= {})[r.month] ?? 0) + q; }
  }
  const flagSet = new Set(flagged.map((a) => `${a.item}|${a.month}`));
  const items = Object.keys(totals).filter((it) => Object.values(totals[it]!).some((q) => q > 0)).sort();

  return (
    <>
      <p><Link href="/">← Back</Link></p>
      <h1>{reqs[0]!.hostelName}</h1>
      <p className="mut">{reqs[0]!.districtName} · {reqs.length} requests · highlighted cells were flagged</p>
      <table>
        <thead><tr><th>Item</th>{months.map((m) => <th key={m} className="num">{m}</th>)}</tr></thead>
        <tbody>
          {items.map((it) => (
            <tr key={it}><td>{it}</td>{months.map((m) => <td key={m} className={`num ${flagSet.has(`${it}|${m}`) ? 'hl sev high' : ''}`}>{totals[it]![m] ?? 0}</td>)}</tr>
          ))}
        </tbody>
      </table>
      <h2>Requests</h2>
      <table>
        <thead><tr><th>Request</th><th>Date</th><th>Month</th><th>Status</th></tr></thead>
        <tbody>{reqs.sort((a, b) => b.requestDate.localeCompare(a.requestDate)).map((r) => <tr key={r.requestId}><td>{r.requestId}</td><td>{r.requestDate}</td><td>{r.month}</td><td>{r.status}</td></tr>)}</tbody>
      </table>
    </>
  );
}
