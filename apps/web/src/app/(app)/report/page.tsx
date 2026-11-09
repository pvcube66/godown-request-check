import Link from 'next/link';
import { getDb } from '@/lib/db';
import { hostelLabel, IMPORTANCE, itemLabel, METHOD_TEXT, monthLabel, num, timesMore } from '@/lib/format';
import { loadReport } from '@/lib/report';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

export default async function Report({ searchParams }: { searchParams: Promise<{ month?: string; district?: string; q?: string }> }) {
  const sp = await searchParams;
  const rows = await loadReport(await getDb(), sp);
  const byHostel = new Map<string, typeof rows>();
  for (const r of rows) { const k = `${r.godownId}|${r.hostelCode}`; (byHostel.get(k) ?? byHostel.set(k, []).get(k)!).push(r); }
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const filters = [sp.month && monthLabel(sp.month), sp.district && `${sp.district} district`, sp.q && `hostels matching “${sp.q}”`].filter(Boolean).join(', ');

  return (
    <div className="report">
      <div className="noprint report-bar">
        <Link href="/">Back to the list</Link>
        <PrintButton />
        <Link href={`/report/csv?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])}`}>Download for Excel</Link>
      </div>
      <h1>Unusual goods requests</h1>
      <p className="mut">Prepared on {today}. {filters ? `Showing ${filters}. ` : ''}
        {rows.length === 0 ? 'Nothing needs checking.' : `${rows.length} item${rows.length > 1 ? 's' : ''} at ${byHostel.size} hostel${byHostel.size > 1 ? 's' : ''} need checking. Only the “Check now” and “Take a look” items are included.`}</p>
      {[...byHostel.values()].map((g) => (
        <section key={g[0]!.hostelCode} className="report-hostel">
          <h2>{hostelLabel(g[0]!.hostelName)} <span className="mut">{g[0]!.districtName} district</span></h2>
          <ul>
            {g.map((a) => (
              <li key={a.key}>
                <b>{itemLabel(a.item)}</b> for {monthLabel(a.month)}: asked for <b>{num(a.requested)}</b>, usually about {num(a.expected)} ({timesMore(a.ratio)}).
                {' '}<span className="mut">{IMPORTANCE[a.severity]}. {METHOD_TEXT[a.method]}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
