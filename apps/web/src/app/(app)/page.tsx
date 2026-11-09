import Link from 'next/link';
import { getDb } from '@/lib/db';
import { hostelLabel, itemLabel, monthLabel, num, SEVERITY, timesMore } from '@/lib/format';
import { setAnomalyStatus } from './actions';
import FilterSelect from './FilterSelect';
import type { AnomalyDoc } from '@anomaly/core';

export const dynamic = 'force-dynamic';
type SP = { sev?: string; month?: string; district?: string; view?: string; all?: string };
const HOSTELS_SHOWN = 20, ITEMS_SHOWN = 3;
const qs = (cur: SP, patch: Partial<SP>) => {
  const p = new URLSearchParams(Object.entries({ ...cur, ...patch }).filter(([, v]) => v) as [string, string][]);
  return `/?${p}`;
};

const HEADLINE: Record<string, string> = {
  high: 'asked for far more than usual',
  medium: 'asked for noticeably more than usual',
  low: 'asked for a bit more than usual',
};

function FlagRow({ a, view }: { a: AnomalyDoc; view: string }) {
  const sev = SEVERITY[a.severity];
  const usualPct = Math.max(2, Math.min(100, (a.expected / a.requested) * 100));
  return (
    <div className="flag">
      <div className="flag-top">
        <h3>{itemLabel(a.item)}</h3>
        <span className={`pill ${sev.cls}`}>{sev.label}</span>
        <span className="mut">for {monthLabel(a.month)}</span>
      </div>
      <p className="sentence">
        Asked for <b>{num(a.requested)}</b>. Usually about <b>{num(a.expected)}</b>, so this is <b>{timesMore(a.ratio)}</b>.
      </p>
      <div className="bars" role="img" aria-label={`Usually ${num(a.expected)}, this time ${num(a.requested)}`}>
        <div className="bar-row"><span>Usually</span><div className="track"><i className="b-usual" style={{ width: `${usualPct}%` }} /></div><b>{num(a.expected)}</b></div>
        <div className="bar-row"><span>This time</span><div className="track"><i className={`b-${sev.cls}`} style={{ width: '100%' }} /></div><b>{num(a.requested)}</b></div>
      </div>
      <p className="why">{a.method === 'own-history'
        ? 'Compared with what this hostel asked for in earlier months.'
        : 'This hostel has no earlier months to compare, so this is compared with similar hostels.'}</p>
      <div className="actions">
        {view === 'open' ? (
          <>
            <form action={setAnomalyStatus}><input type="hidden" name="key" value={a.key} /><input type="hidden" name="status" value="confirmed" /><button className="btn problem">This looks wrong</button></form>
            <form action={setAnomalyStatus}><input type="hidden" name="key" value={a.key} /><input type="hidden" name="status" value="ignored" /><button className="btn fine">This is fine</button></form>
            <form action={setAnomalyStatus}><input type="hidden" name="key" value={a.key} /><input type="hidden" name="status" value="expected" /><button className="btn soft" title="Stop flagging this item for this hostel">Always normal for this hostel</button></form>
          </>
        ) : (
          <form action={setAnomalyStatus}><input type="hidden" name="key" value={a.key} /><input type="hidden" name="status" value="open" /><button className="btn">Move back to “To check”</button></form>
        )}
      </div>
    </div>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sev = (['high', 'medium', 'low'] as const).includes(sp.sev as 'high') ? (sp.sev as 'high' | 'medium' | 'low') : 'high';
  const view = ['open', 'confirmed', 'fine'].includes(sp.view ?? '') ? sp.view! : 'open';
  const c = await getDb();

  const scope: Record<string, unknown> = {};
  if (sp.month) scope.month = sp.month;
  if (sp.district) scope.districtName = sp.district;
  const statusFilter = view === 'fine' ? { $in: ['ignored', 'expected'] } : view;

  const [rows, counts, months, districts] = await Promise.all([
    c.anomalies.find({ ...scope, status: statusFilter, severity: sev } as never).sort({ ratio: -1 }).limit(3000).toArray(),
    c.anomalies.aggregate<{ _id: string; n: number }>([{ $match: { ...scope, status: statusFilter } }, { $group: { _id: '$severity', n: { $sum: 1 } } }]).toArray(),
    c.anomalies.distinct('month'),
    c.anomalies.distinct('districtName'),
  ]);
  const count = (s: string) => counts.find((x) => x._id === s)?.n ?? 0;

  const byHostel = new Map<string, AnomalyDoc[]>();
  for (const r of rows) { const k = `${r.godownId}|${r.hostelCode}`; (byHostel.get(k) ?? byHostel.set(k, []).get(k)!).push(r); }
  const groups = [...byHostel.values()].sort((a, b) => b[0]!.ratio - a[0]!.ratio);
  const shown = sp.all ? groups : groups.slice(0, HOSTELS_SHOWN);

  const base = Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>;
  const headline = view === 'open'
    ? groups.length ? `${groups.length} hostel${groups.length > 1 ? 's' : ''} ${HEADLINE[sev]}` : 'All clear'
    : view === 'confirmed' ? 'Requests you marked as wrong' : 'Requests you marked as fine';

  return (
    <>
      <div className="hero">
        <h1>{headline}</h1>
        <p>{view === 'open'
          ? 'We compare every request with what the hostel normally asks for. Anything much bigger is listed here so you can check it.'
          : 'You can move any of these back to the “To check” list.'}</p>
      </div>

      <div className="tabs" role="tablist" aria-label="How big is the difference">
        {(['high', 'medium', 'low'] as const).map((s) => (
          <Link key={s} href={qs(sp, { sev: s, all: '' })} className={`tab ${s} ${sev === s ? 'on' : ''}`} aria-current={sev === s ? 'page' : undefined}>
            <b>{count(s)} <small>{count(s) === 1 ? 'item' : 'items'}</small></b><span>{SEVERITY[s].label}. {SEVERITY[s].hint}.</span>
          </Link>
        ))}
      </div>

      <div className="filters">
        <FilterSelect label="Month" name="month" value={sp.month ?? ''} base={base}
          options={[{ value: '', label: 'All months' }, ...months.sort().reverse().map((m) => ({ value: m, label: monthLabel(m) }))]} />
        {districts.length > 1 && (
          <FilterSelect label="District" name="district" value={sp.district ?? ''} base={base}
            options={[{ value: '', label: 'All districts' }, ...districts.sort().map((d) => ({ value: d, label: d }))]} />
        )}
        <div className="seg" aria-label="Which requests to show">
          {[['open', 'To check'], ['confirmed', 'Marked wrong'], ['fine', 'Marked fine']].map(([v, l]) => (
            <Link key={v} href={qs(sp, { view: v === 'open' ? '' : v, all: '' })} className={view === v ? 'on' : ''}>{l}</Link>
          ))}
        </div>
      </div>

      {groups.length === 0 && (view === 'open'
        ? <div className="empty" style={{ marginTop: 20 }}>Nothing to check here right now. Try another tab above.</div>
        : <div className="empty" style={{ marginTop: 20 }}>Nothing here yet.</div>)}

      {groups.length > 0 && <p className="count-line">Showing the biggest differences first.</p>}

      {shown.map((g) => {
        const top = g[0]!;
        const first = g.slice(0, ITEMS_SHOWN), rest = g.slice(ITEMS_SHOWN);
        return (
          <section className="hostel" key={`${top.godownId}|${top.hostelCode}`}>
            <div className="hostel-head">
              <div><h2>{hostelLabel(top.hostelName)}</h2><p className="where">{top.districtName} district</p></div>
              <Link href={`/hostel/${top.hostelCode}?g=${top.godownId}`}>See all months</Link>
            </div>
            {first.map((a) => <FlagRow key={a.key} a={a} view={view} />)}
            {rest.length > 0 && (
              <details className="more">
                <summary>Show {rest.length} more item{rest.length > 1 ? 's' : ''} for this hostel</summary>
                {rest.map((a) => <FlagRow key={a.key} a={a} view={view} />)}
              </details>
            )}
          </section>
        );
      })}
      {!sp.all && groups.length > HOSTELS_SHOWN && (
        <Link className="showall" href={qs(sp, { all: '1' })}>Show the other {groups.length - HOSTELS_SHOWN} hostels</Link>
      )}
    </>
  );
}
