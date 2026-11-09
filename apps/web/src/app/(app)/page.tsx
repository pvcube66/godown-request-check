import Link from 'next/link';
import { getDb } from '@/lib/db';
import { ago, hostelLabel, itemLabel, monthLabel, num, SEVERITY, timesMore } from '@/lib/format';
import { groupFlags } from '@/lib/group';
import { loadHistory, loadOrderItems } from '@/lib/history';
import { OrderCard, SpikeCard, TypingCard } from '@/components/FlagCards';
import { Icon } from '@/components/Icons';
import BarChart from './BarChart';
import FilterSelect from './FilterSelect';
import type { AnomalyDoc } from '@anomaly/core';

export const dynamic = 'force-dynamic';
type SP = { sev?: string; month?: string; district?: string; view?: string; all?: string; q?: string };
const HOSTELS_SHOWN = 15, CARDS_SHOWN = 3;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const qs = (cur: SP, patch: Partial<SP>) => {
  const p = new URLSearchParams(Object.entries({ ...cur, ...patch }).filter(([, v]) => v) as [string, string][]);
  return `/?${p}`;
};
const HEADLINE: Record<string, string> = { high: 'asked for far more than usual', medium: 'asked for noticeably more than usual', low: 'asked for a bit more than usual' };
const IST = 'Asia/Kolkata';
const SEV_ICON = { high: 'alert', medium: 'eye', low: 'info' } as const;

function nextCheck(now = Date.now()) {
  const off = 19_800_000;                                    // IST is UTC+5:30; checks run at the top of each IST hour
  return new Date(Math.ceil((now + off) / 3_600_000) * 3_600_000 - off);
}

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sev = (['high', 'medium', 'low'] as const).includes(sp.sev as 'high') ? (sp.sev as 'high' | 'medium' | 'low') : 'high';
  const view = (['open', 'confirmed', 'fine'].includes(sp.view ?? '') ? sp.view! : 'open') as 'open' | 'confirmed' | 'fine';
  const c = await getDb();

  const scope: Record<string, unknown> = { partOfOrder: { $ne: true } };
  if (sp.month) scope.month = sp.month;
  if (sp.district) scope.districtName = sp.district;
  const q = (sp.q ?? '').trim().slice(0, 60);
  if (q) scope.hostelName = { $regex: escapeRe(q), $options: 'i' };
  const statusFilter = view === 'fine' ? { $in: ['ignored', 'expected'] } : view;
  const attention = { ...scope, status: 'open', severity: { $in: ['high', 'medium'] } };
  const showSummary = view === 'open';

  const [rows, counts, months, districts, topRows, byDistrict, byItem, lastRun] = await Promise.all([
    c.anomalies.find({ ...scope, status: statusFilter, severity: sev } as never).sort({ ratio: -1 }).limit(3000).toArray(),
    c.anomalies.aggregate<{ _id: string; n: number }>([{ $match: { ...scope, status: statusFilter } }, { $group: { _id: '$severity', n: { $sum: 1 } } }]).toArray(),
    c.anomalies.distinct('month'),
    c.anomalies.distinct('districtName'),
    showSummary ? c.anomalies.find({ ...scope, status: 'open', severity: 'high' } as never).sort({ ratio: -1 }).limit(60).toArray() : [],
    showSummary ? c.anomalies.aggregate<{ _id: string; n: number }>([{ $match: attention }, { $group: { _id: '$districtName', h: { $addToSet: '$hostelCode' } } }, { $project: { n: { $size: '$h' } } }, { $sort: { n: -1 } }, { $limit: 6 }]).toArray() : [],
    showSummary ? c.anomalies.aggregate<{ _id: string; n: number }>([{ $match: attention }, { $group: { _id: '$item', h: { $addToSet: '$hostelCode' } } }, { $project: { n: { $size: '$h' } } }, { $sort: { n: -1 } }, { $limit: 6 }]).toArray() : [],
    c.runs.find().sort({ startedAt: -1 }).limit(1).next(),
  ]);
  const count = (s: string) => counts.find((x) => x._id === s)?.n ?? 0;

  // Start-here list: one line per hostel. A typing mistake counts as one line, not five.
  const seen = new Set<string>();
  const top: { hostel: AnomalyDoc; text: 'typing' | 'spike' | 'order'; a: AnomalyDoc; n: number }[] = [];
  for (const r of topRows) {
    if (seen.has(r.hostelCode)) continue; seen.add(r.hostelCode);
    top.push({ hostel: r, a: r, text: r.kind === 'typing' ? 'typing' : r.kind === 'order' ? 'order' : 'spike', n: r.slip?.count ?? r.order?.itemsCompared ?? 1 });
    if (top.length === 3) break;
  }

  const byHostel = new Map<string, AnomalyDoc[]>();
  for (const r of rows) { const k = `${r.godownId}|${r.hostelCode}`; (byHostel.get(k) ?? byHostel.set(k, []).get(k)!).push(r); }
  const groups = [...byHostel.values()].sort((a, b) => b[0]!.ratio - a[0]!.ratio);
  const shown = sp.all ? groups : groups.slice(0, HOSTELS_SHOWN);
  const { history, months: allMonths } = await loadHistory(c, shown.map((g) => ({ godownId: g[0]!.godownId, hostelCode: g[0]!.hostelCode })));
  const orderItems = await loadOrderItems(c, shown.flatMap((g) => g.filter((a) => a.kind === 'order')));
  const ctx = { history, months: allMonths, view };

  const base = Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>;
  const reportQuery = new URLSearchParams(Object.entries({ month: sp.month ?? '', district: sp.district ?? '', q }).filter(([, v]) => v) as [string, string][]).toString();
  const hour = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: IST }));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLine = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: IST });
  const headline = view === 'open'
    ? groups.length ? `${groups.length} hostel${groups.length > 1 ? 's' : ''} ${HEADLINE[sev]}` : q ? `No match for “${q}”` : 'All clear'
    : view === 'confirmed' ? 'Requests you marked as wrong' : 'Requests you marked as fine';
  const checkedOk = lastRun?.ok;

  return (
    <>
      <section className="hero">
        <p className="greet">{greeting}. Today is {dateLine}.</p>
        <h1>{headline}</h1>
        <p className="lede">{view === 'open'
          ? 'We compare every request with what the hostel normally asks for. Anything much bigger is listed here so you can check it.'
          : 'You can move any of these back to the “To check” list.'}</p>
        <p className={`status ${checkedOk === false ? 'bad' : ''}`}>
          <span className="live" aria-hidden="true" />
          {lastRun ? <>Last checked {ago(lastRun.startedAt)}. Next check at {nextCheck().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST })}.</> : 'No check has run yet.'}
          {checkedOk === false && <b> The last check had a problem.</b>}
        </p>
      </section>

      {showSummary && top.length > 0 && (
        <section className="summary" aria-labelledby="start-here">
          <h2 id="start-here">Start here</h2>
          <p className="sub-lede">These are the biggest jumps. Check these first.</p>
          <ul>
            {top.map(({ a, text, n }) => (
              <li key={a.key}>
                <span className="sum-icon"><Icon name={text === 'typing' ? 'pencil' : 'alert'} size={18} /></span>
                <span>
                  <b>{hostelLabel(a.hostelName)}</b>{' '}
                  {text === 'order'
                    ? <>asked for <b>{timesMore(a.ratio).replace(' more', '')}</b> what hostels with a similar number of students ask, across <b>{n} items</b> in {monthLabel(a.month)}.</>
                    : text === 'typing'
                    ? <>entered the same number, <b>{num(a.slip!.value)}</b>, for <b>{n} different items</b> in {monthLabel(a.month)}. This may be a typing mistake.</>
                    : <>asked for {itemLabel(a.item)}: <b>{num(a.requested)}</b>, when {a.method === 'peers' ? 'other hostels like it ask for' : 'it usually asks for'} about <b>{num(a.expected)}</b>.</>}
                  {' '}<Link href={`/hostel/${a.hostelCode}?g=${a.godownId}`} className="link-arrow">See this hostel<Icon name="arrow" size={15} /></Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {showSummary && (byDistrict.length > 0 || byItem.length > 0) && (
        <div className="charts">
          <BarChart title="Where are the unusual requests?" note="Hostels to check, by district." unit="hostel" data={byDistrict.map((d) => ({ label: d._id, value: d.n }))} />
          <BarChart title="What is asked for too much?" note="Items that many hostels asked for far more than usual." unit="hostel" data={byItem.map((d) => ({ label: itemLabel(d._id), value: d.n }))} />
        </div>
      )}

      <nav className="tabs" aria-label="How big is the difference">
        {(['high', 'medium', 'low'] as const).map((s) => (
          <Link key={s} href={qs(sp, { sev: s, all: '' })} className={`tab ${s} ${sev === s ? 'on' : ''}`} aria-current={sev === s ? 'page' : undefined}>
            <span className="tab-icon"><Icon name={SEV_ICON[s]} size={20} /></span>
            <span className="tab-body"><b>{count(s)} <small>{count(s) === 1 ? 'item' : 'items'}</small></b><span>{SEVERITY[s].label}. {SEVERITY[s].hint}.</span></span>
          </Link>
        ))}
      </nav>

      <div className="filters">
        <form action="/" method="get" className="search" role="search">
          {Object.entries(base).filter(([k]) => k !== 'q' && k !== 'all').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label htmlFor="q">Find a hostel</label>
          <div className="search-row">
            <span className="search-box"><Icon name="search" size={18} /><input id="q" name="q" defaultValue={q} placeholder="Type part of the name" autoComplete="off" /></span>
            <button className="btn">Search</button>
            {q && <Link href={qs(sp, { q: '', all: '' })} className="link-arrow">Clear</Link>}
          </div>
        </form>
        <FilterSelect label="Month" name="month" value={sp.month ?? ''} base={base} options={[{ value: '', label: 'All months' }, ...months.sort().reverse().map((m) => ({ value: m, label: monthLabel(m) }))]} />
        {districts.length > 1 && <FilterSelect label="District" name="district" value={sp.district ?? ''} base={base} options={[{ value: '', label: 'All districts' }, ...districts.sort().map((d) => ({ value: d, label: d }))]} />}
        <div className="seg" role="group" aria-label="Which requests to show">
          {[['open', 'To check'], ['confirmed', 'Marked wrong'], ['fine', 'Marked fine']].map(([v, l]) => (
            <Link key={v} href={qs(sp, { view: v === 'open' ? '' : v, all: '' })} className={view === v ? 'on' : ''} aria-current={view === v ? 'page' : undefined}>{l}</Link>
          ))}
        </div>
      </div>

      <p className="report-links">
        <Link href={`/report${reportQuery ? `?${reportQuery}` : ''}`} className="link-arrow"><Icon name="print" size={17} />Print or save as PDF</Link>
        <Link href={`/report/csv${reportQuery ? `?${reportQuery}` : ''}`} className="link-arrow"><Icon name="download" size={17} />Download for Excel</Link>
      </p>

      {groups.length === 0 && (
        <div className="empty">
          <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="34" fill="#e3f1f0" /><path d="M23 37l9 9 18-20" fill="none" stroke="#0a5c63" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <h2>{q ? 'No hostel found' : view === 'open' ? 'Nothing to check here' : 'Nothing here yet'}</h2>
          <p>{q ? `No hostel matching “${q}” has anything in this list.` : view === 'open' ? 'Everything in this group looks normal. Try the other tabs above.' : 'Requests you mark will appear here.'}</p>
        </div>
      )}

      {shown.map((g) => {
        const top1 = g[0]!;
        const { orders, typing, spikes } = groupFlags(g);
        const cards = [
          ...orders.map((o) => ({ key: o.key, node: <OrderCard key={o.key} a={o} items={orderItems.get(`${o.godownId}|${o.hostelCode}|${o.month}`) ?? []} ctx={ctx} /> })),
          ...typing.map((t) => ({ key: `t|${t.month}|${t.value}`, node: <TypingCard key={`t|${t.month}|${t.value}`} g={t} ctx={ctx} /> })),
          ...spikes.map((a) => ({ key: a.key, node: <SpikeCard key={a.key} a={a} ctx={ctx} /> })),
        ];
        return (
          <section className="hostel" key={`${top1.godownId}|${top1.hostelCode}`}>
            <header className="hostel-head">
              <div><h2>{hostelLabel(top1.hostelName)}</h2><p className="where"><Icon name="pin" size={15} />{top1.districtName} district</p></div>
              <div className="hostel-meta">
                <span className="count-chip">{cards.length} to look at</span>
                <Link href={`/hostel/${top1.hostelCode}?g=${top1.godownId}`} className="link-arrow">See all months<Icon name="arrow" size={15} /></Link>
              </div>
            </header>
            {cards.slice(0, CARDS_SHOWN).map((x) => x.node)}
            {cards.length > CARDS_SHOWN && (
              <details className="more">
                <summary><Icon name="chevron" size={18} />Show {cards.length - CARDS_SHOWN} more for this hostel</summary>
                {cards.slice(CARDS_SHOWN).map((x) => x.node)}
              </details>
            )}
          </section>
        );
      })}
      {!sp.all && groups.length > HOSTELS_SHOWN && (
        <Link className="btn showall" href={qs(sp, { all: '1' })}>Show the other {groups.length - HOSTELS_SHOWN} hostels</Link>
      )}
    </>
  );
}
