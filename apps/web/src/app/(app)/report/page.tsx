import Link from 'next/link';
import { getDb } from '@/lib/db';
import { loadItemNames } from '@/lib/item-names';
import { loadUnits, unitFor, withUnit } from '@/lib/units';
import { scopeFor } from '@/lib/viewer';
import { hostelLabel, IMPORTANCE, itemLabel, METHOD_TEXT, monthLabel, num, timesMore } from '@/lib/format';
import { loadReport } from '@/lib/report';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Unusual goods report' };

export default async function Report({ searchParams }: { searchParams: Promise<{ month?: string; district?: string; q?: string }> }) {
  const sp = await searchParams;
  const c = await getDb();
  const itemNames = await loadItemNames(c);
  const units = await loadUnits(c);
  const { names } = await scopeFor(c);
  const rows = await loadReport(c, sp, names);
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
      {[...byHostel.values()].map((g, i) => (
        <section key={g[0]!.hostelCode} className="report-hostel">
          <h2><span className="report-sn">{i + 1}.</span> {hostelLabel(g[0]!.hostelName)} <span className="mut">{g[0]!.districtName} district. Hostel ID {g[0]!.hostelCode}</span></h2>
          <ul>
            {g.map((a) => (
              <li key={a.key}>
                {a.kind === 'duplicate'
                  ? <><b>Possible duplicate request</b> for {monthLabel(a.month)}: {a.dup?.requestIds.join(' and ')} are {Math.round((a.dup?.similarity ?? 0) * 100)}% the same across {a.dup?.items} items.</>
                  : a.kind === 'order'
                  ? <><b>Whole order</b> for {monthLabel(a.month)}: {timesMore(a.ratio).replace(' more', '')} what hostels with a similar number of students ask, across {a.order?.itemsCompared} items.</>
                  : <><b>{itemLabel(a.item, itemNames)}</b> for {monthLabel(a.month)}: asked for <b>{withUnit(num(a.requested), unitFor(a.item, units))}</b>, when {a.method === 'peers' ? 'other hostels like it ask for' : 'it usually asks for'} about {withUnit(num(a.expected), unitFor(a.item, units))} ({timesMore(a.ratio)}).</>}
                {' '}<span className="mut">{IMPORTANCE[a.severity]}. {METHOD_TEXT[a.method]}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
