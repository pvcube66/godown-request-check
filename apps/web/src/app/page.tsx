import Link from 'next/link';
import { getDb } from '@/lib/db';
import { setAnomalyStatus } from './actions';
import type { AnomalyDoc } from '@anomaly/core';

export const dynamic = 'force-dynamic';
type SP = { month?: string; sev?: string; status?: string; district?: string };
const qs = (cur: SP, patch: Partial<SP>) => {
  const p = new URLSearchParams(Object.entries({ ...cur, ...patch }).filter(([, v]) => v) as [string, string][]);
  return `/?${p}`;
};

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const c = await getDb();
  const sev = sp.sev ?? 'mh';                       // default: medium + high only
  const status = sp.status ?? 'open';
  const filter: Record<string, unknown> = { status };
  if (sev === 'mh') filter.severity = { $in: ['medium', 'high'] };
  else if (sev !== 'all') filter.severity = sev;
  if (sp.month) filter.month = sp.month;
  if (sp.district) filter.districtName = sp.district;

  const [rows, months, districts, openAll, lastRun, accts] = await Promise.all([
    c.anomalies.find(filter).sort({ ratio: -1 }).limit(2000).toArray(),
    c.anomalies.distinct('month'),
    c.anomalies.distinct('districtName'),
    c.anomalies.aggregate<{ _id: string; n: number }>([{ $match: { status: 'open' } }, { $group: { _id: '$severity', n: { $sum: 1 } } }]).toArray(),
    c.runs.find().sort({ startedAt: -1 }).limit(1).next(),
    c.accounts.find({}, { projection: { username: 1, status: 1, lastError: 1 } }).toArray(),
  ]);
  const count = (s: string) => openAll.find((x) => x._id === s)?.n ?? 0;
  const bad = accts.filter((a) => a.status !== 'active');

  const byHostel = new Map<string, AnomalyDoc[]>();
  for (const r of rows) (byHostel.get(`${r.godownId}|${r.hostelCode}`) ?? byHostel.set(`${r.godownId}|${r.hostelCode}`, []).get(`${r.godownId}|${r.hostelCode}`)!).push(r);
  const groups = [...byHostel.values()].sort((a, b) => Math.max(...b.map((x) => x.ratio)) - Math.max(...a.map((x) => x.ratio)));

  return (
    <>
      <h1>Flagged requests</h1>
      <div className="tiles">
        <div className="tile"><b className="sev high">{count('high')}</b><span>High (open)</span></div>
        <div className="tile"><b className="sev medium">{count('medium')}</b><span>Medium (open)</span></div>
        <div className="tile"><b className="sev low">{count('low')}</b><span>Low (open)</span></div>
        <div className="tile"><b className={lastRun?.ok ? 'ok' : 'bad'}>{lastRun ? (lastRun.ok ? 'OK' : 'Problem') : '—'}</b>
          <span>Last check: {lastRun ? lastRun.startedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'never'}</span></div>
        <div className="tile"><b className={bad.length ? 'bad' : 'ok'}>{accts.length - bad.length}/{accts.length}</b><span>Godown logins working</span></div>
      </div>
      {bad.length > 0 && <p className="bad">Login problem: {bad.map((a) => `${a.username} (${a.lastError ?? a.status})`).join('; ')}</p>}

      <div className="filters">
        <span className="mut">Severity:</span>
        {[['mh', 'Medium + High'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['all', 'All']].map(([v, l]) => <Link key={v} href={qs(sp, { sev: v })} className={sev === v ? 'on' : ''}>{l}</Link>)}
        <span className="mut" style={{ marginLeft: 12 }}>Month:</span>
        <Link href={qs(sp, { month: '' })} className={!sp.month ? 'on' : ''}>All</Link>
        {months.sort().reverse().map((m) => <Link key={m} href={qs(sp, { month: m })} className={sp.month === m ? 'on' : ''}>{m}</Link>)}
        <span className="mut" style={{ marginLeft: 12 }}>Status:</span>
        {['open', 'confirmed', 'ignored', 'expected', 'resolved'].map((s) => <Link key={s} href={qs(sp, { status: s })} className={status === s ? 'on' : ''}>{s}</Link>)}
        {districts.length > 1 && <><span className="mut" style={{ marginLeft: 12 }}>District:</span>
          <Link href={qs(sp, { district: '' })} className={!sp.district ? 'on' : ''}>All</Link>
          {districts.sort().map((d) => <Link key={d} href={qs(sp, { district: d })} className={sp.district === d ? 'on' : ''}>{d}</Link>)}</>}
      </div>

      <p className="mut">{rows.length} flagged items across {groups.length} hostels. Largest jump first.</p>
      {groups.length === 0 && <p>Nothing flagged with these filters.</p>}
      {groups.map((g) => {
        const top = g[0]!;
        const worst = g.reduce((a, b) => (b.ratio > a.ratio ? b : a));
        return (
          <details key={`${top.godownId}|${top.hostelCode}`}>
            <summary>
              <span className="name">{top.hostelName}<span className="mut"> · {top.districtName}</span></span>
              <span className={`sev ${worst.severity}`}>{g.length} item{g.length > 1 ? 's' : ''} · worst ×{worst.ratio}</span>
              <Link href={`/hostel/${top.hostelCode}?g=${top.godownId}`}>history →</Link>
            </summary>
            <table>
              <thead><tr><th>Month</th><th>Item</th><th className="num">Requested</th><th className="num">Usual</th><th className="num">×</th><th>Why flagged</th><th>Action</th></tr></thead>
              <tbody>
                {g.map((a) => (
                  <tr key={a.key}>
                    <td>{a.month}</td><td>{a.item}</td>
                    <td className="num"><b>{a.requested}</b></td><td className="num">{a.expected}</td>
                    <td className={`num sev ${a.severity}`}>{a.ratio}</td>
                    <td className="mut">{a.reason}</td>
                    <td>
                      {(['confirmed', 'ignored', 'expected'] as const).map((s) => (
                        <form key={s} action={setAnomalyStatus} className="inline">
                          <input type="hidden" name="key" value={a.key} /><input type="hidden" name="status" value={s} />
                          <button title={s === 'expected' ? 'Normal for this hostel (e.g. festival / more students)' : undefined}>{s === 'confirmed' ? 'Confirm' : s === 'ignored' ? 'Ignore' : 'Normal'}</button>
                        </form>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        );
      })}
    </>
  );
}
