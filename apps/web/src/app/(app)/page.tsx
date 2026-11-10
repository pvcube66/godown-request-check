import { Suspense, cloneElement } from 'react';
import Link from 'next/link';
import { PageSkeleton } from '@/components/Skeletons';
import { getDb } from '@/lib/db';
import { scopeFor } from '@/lib/viewer';
import { ago, hostelLabel, itemLabel, monthLabel, num, SEVERITY, timesMore } from '@/lib/format';
import { groupFlags } from '@/lib/group';
import { loadHistory, loadOrderItems, loadRequestsById } from '@/lib/history';
import { DuplicateCard, OrderCard, SpikeCard, TypingCard } from '@/components/FlagCards';
import { Icon } from '@/components/Icons';
import BarChart from './BarChart';
import FilterSelect from './FilterSelect';
import SearchBox from './SearchBox';
import { scoped, canEdit, type AnomalyDoc } from '@anomaly/core';

export const dynamic = 'force-dynamic';
type SP = { sev?: string; month?: string; district?: string; view?: string; p?: string; all?: string; q?: string };
const PAGE_SIZE = 8, CARDS_SHOWN = 3;
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
  // the key makes the placeholder appear again whenever a filter, tab or search changes
  return <Suspense key={JSON.stringify(sp)} fallback={<PageSkeleton />}><HomeContent sp={sp} /></Suspense>;
}

async function HomeContent({ sp }: { sp: SP }) {
  const sev = (['high', 'medium', 'low'] as const).includes(sp.sev as 'high') ? (sp.sev as 'high' | 'medium' | 'low') : 'high';
  const view = (['open', 'confirmed', 'fine'].includes(sp.view ?? '') ? sp.view! : 'open') as 'open' | 'confirmed' | 'fine';
  const c = await getDb();
  const { viewer, names } = await scopeFor(c);

  const base0: Record<string, unknown> = { partOfOrder: { $ne: true } };
  if (sp.month) base0.month = sp.month;
  if (sp.district) base0.districtName = sp.district;
  const q = (sp.q ?? '').trim().slice(0, 60);
  if (q) base0.hostelName = { $regex: escapeRe(q), $options: 'i' };
  const scope = scoped(base0, names);
  const statusFilter = view === 'fine' ? { $in: ['ignored', 'expected'] } : view;
  const attention = { ...scope, status: 'open', severity: { $in: ['high', 'medium'] } };
  const showSummary = view === 'open';

  const [rows, counts, months, districts, topRows, byDistrict, byItem, lastRun, requestMonths] = await Promise.all([
    c.anomalies.find({ ...scope, status: statusFilter, severity: sev } as never).sort({ ratio: -1 }).limit(3000).toArray(),
    c.anomalies.aggregate<{ _id: string; n: number }>([{ $match: { ...scope, status: statusFilter } }, { $group: { _id: '$severity', n: { $sum: 1 } } }]).toArray(),
    c.anomalies.distinct('month', scoped({}, names)),
    c.anomalies.distinct('districtName', scoped({}, names)),
    showSummary ? c.anomalies.find({ ...scope, status: 'open', severity: 'high' } as never).sort({ ratio: -1 }).limit(60).toArray() : [],
    showSummary ? c.anomalies.aggregate<{ _id: string; n: number }>([{ $match: attention }, { $group: { _id: '$districtName', h: { $addToSet: '$hostelCode' } } }, { $project: { n: { $size: '$h' } } }, { $sort: { n: -1 } }, { $limit: 6 }]).toArray() : [],
    showSummary ? c.anomalies.aggregate<{ _id: string; n: number }>([{ $match: attention }, { $group: { _id: '$item', h: { $addToSet: '$hostelCode' } } }, { $project: { n: { $size: '$h' } } }, { $sort: { n: -1 } }, { $limit: 6 }]).toArray() : [],
    c.runs.find().sort({ startedAt: -1 }).limit(1).next(),
    c.requests.distinct('month', scoped({}, names)),
  ]);
  const count = (s: string) => counts.find((x) => x._id === s)?.n ?? 0;

  // Start-here list: one line per hostel. A typing mistake counts as one line, not five.
  const seen = new Set<string>();
  const top: { hostel: AnomalyDoc; text: 'typing' | 'spike' | 'order' | 'duplicate'; a: AnomalyDoc; n: number }[] = [];
  for (const r of topRows) {
    if (seen.has(r.hostelCode)) continue; seen.add(r.hostelCode);
    top.push({ hostel: r, a: r, text: r.kind === 'typing' ? 'typing' : r.kind === 'order' ? 'order' : r.kind === 'duplicate' ? 'duplicate' : 'spike', n: r.slip?.count ?? r.order?.itemsCompared ?? r.dup?.items ?? 1 });
    if (top.length === 3) break;
  }

  const byHostel = new Map<string, AnomalyDoc[]>();
  for (const r of rows) { const k = `${r.godownId}|${r.hostelCode}`; (byHostel.get(k) ?? byHostel.set(k, []).get(k)!).push(r); }
  const groups = [...byHostel.values()].sort((a, b) => b[0]!.ratio - a[0]!.ratio);
  const pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const pageNo = Math.min(pages, Math.max(1, Math.floor(Number(sp.p)) || 1));
  const offset = (pageNo - 1) * PAGE_SIZE;
  const shown = groups.slice(offset, offset + PAGE_SIZE);
  // the two lookups do not depend on each other, so they run together
  const [{ history, months: allMonths }, orderItems, dupReqs] = await Promise.all([
    loadHistory(c, shown.map((g) => ({ godownId: g[0]!.godownId, hostelCode: g[0]!.hostelCode })), requestMonths.sort()),
    loadOrderItems(c, shown.flatMap((g) => g.filter((a) => a.kind === 'order'))),
    loadRequestsById(c, shown.flatMap((g) => g.filter((a) => a.kind === 'duplicate').flatMap((a) => a.dup!.requestIds))),
  ]);
  const ctx = { history, months: allMonths, view, showActions: canEdit(viewer) };

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
        <details className="summary overview-details">
          <summary><h2>Start here</h2><span className="mut">{top.length} biggest jumps — expand to review</span></summary>
          <p className="sub-lede">These are the biggest jumps. Check these first.</p>
          <ul>
            {top.map(({ a, text, n }) => (
              <li key={a.key}>
                <span className="sum-icon"><Icon name={text === 'typing' ? 'pencil' : 'alert'} size={18} /></span>
                <span>
                  <b>{hostelLabel(a.hostelName)}</b>{' '}
                  {text === 'duplicate'
                    ? <>has two requests for {monthLabel(a.month)} that are <b>{Math.round((a.dup?.similarity ?? 0) * 100)}% the same</b> across <b>{n} items</b>. One may be a duplicate.</>
                    : text === 'order'
                    ? <>asked for <b>{timesMore(a.ratio).replace(' more', '')}</b> what hostels with a similar number of students ask, across <b>{n} items</b> in {monthLabel(a.month)}.</>
                    : text === 'typing'
                    ? <>entered the same number, <b>{num(a.slip!.value)}</b>, for <b>{n} different items</b> in {monthLabel(a.month)}. This may be a typing mistake.</>
                    : <>asked for {itemLabel(a.item)}: <b>{num(a.requested)}</b>, when {a.method === 'peers' ? 'other hostels like it ask for' : 'it usually asks for'} about <b>{num(a.expected)}</b>.</>}
                  {' '}<Link href={`/hostel/${a.hostelCode}?g=${a.godownId}`} className="link-arrow">See this hostel<Icon name="arrow" size={15} /></Link>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {showSummary && (byDistrict.length > 0 || byItem.length > 0) && (
        <details className="summary overview-details">
          <summary><h2>District and item overview</h2><span className="mut">Expand charts</span></summary>
          <div className="charts">
          <BarChart title="Where are the unusual requests?" note="Hostels to check, by district." unit="hostel" data={byDistrict.map((d) => ({ label: d._id, value: d.n }))} />
          <BarChart title="What is asked for too much?" note="Items that many hostels asked for far more than usual." unit="hostel" data={byItem.map((d) => ({ label: itemLabel(d._id), value: d.n }))} />
          </div>
        </details>
      )}

      <nav className="tabs" aria-label="How big is the difference">
        {(['high', 'medium', 'low'] as const).map((s) => (
          <Link key={s} href={qs(sp, { sev: s, p: '' })} className={`tab ${s} ${sev === s ? 'on' : ''}`} aria-current={sev === s ? 'page' : undefined}>
            <span className="tab-icon"><Icon name={SEV_ICON[s]} size={20} /></span>
            <span className="tab-body"><span className="tab-label">{SEVERITY[s].label}</span><b>{count(s)} <small>{count(s) === 1 ? 'item' : 'items'}</small></b><span>{SEVERITY[s].hint}.</span></span>
          </Link>
        ))}
      </nav>

      <div className="filters">
        <SearchBox base={Object.fromEntries(Object.entries(base).filter(([k]) => k !== 'q' && k !== 'all'))} q={q} />
        <FilterSelect label="Month" name="month" value={sp.month ?? ''} base={base} options={[{ value: '', label: 'All months' }, ...months.sort().reverse().map((m) => ({ value: m, label: monthLabel(m) }))]} />
        {districts.length > 1 && <FilterSelect label="District" name="district" value={sp.district ?? ''} base={base} options={[{ value: '', label: 'All districts' }, ...districts.sort().map((d) => ({ value: d, label: d }))]} />}
        <div className="seg" role="group" aria-label="Which requests to show">
          {[['open', 'To check'], ['confirmed', 'Marked wrong'], ['fine', 'Marked fine']].map(([v, l]) => (
            <Link key={v} href={qs(sp, { view: v === 'open' ? '' : v, p: '' })} className={view === v ? 'on' : ''} aria-current={view === v ? 'page' : undefined}>{l}</Link>
          ))}
        </div>
      </div>

      <p className="report-links">
        <Link href={`/report${reportQuery ? `?${reportQuery}` : ''}`} className="link-arrow"><Icon name="print" size={17} />Print or save as PDF</Link>
        <Link href={`/report/csv${reportQuery ? `?${reportQuery}` : ''}`} className="link-arrow"><Icon name="download" size={17} />Download for Excel</Link>
      </p>

      {groups.length === 0 && (
        <div className="empty">
          <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="34" fill="var(--surface)" /><path d="M23 37l9 9 18-20" fill="none" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <h2>{q ? 'No hostel found' : view === 'open' ? 'Nothing to check here' : 'Nothing here yet'}</h2>
          <p>{q ? `No hostel matching “${q}” has anything in this list.` : view === 'open' ? 'Everything in this group looks normal. Try the other tabs above.' : 'Requests you mark will appear here.'}</p>
        </div>
      )}

      {shown.map((g, hi) => {
        const top1 = g[0]!;
        const sn = offset + hi + 1;
        const { orders, duplicates, typing, spikes } = groupFlags(g);
        const cards = [
          ...duplicates.map((d) => ({ key: d.key, node: <DuplicateCard key={d.key} a={d} ctx={ctx} reqs={dupReqs} /> })),
          ...orders.map((o) => ({ key: o.key, node: <OrderCard key={o.key} a={o} items={orderItems.get(`${o.godownId}|${o.hostelCode}|${o.month}`) ?? []} ctx={ctx} /> })),
          ...typing.map((t) => ({ key: `t|${t.month}|${t.value}`, node: <TypingCard key={`t|${t.month}|${t.value}`} g={t} ctx={ctx} /> })),
          ...spikes.map((a) => ({ key: a.key, node: <SpikeCard key={a.key} a={a} ctx={ctx} /> })),
        ];
        const numbered = cards.map((x, ci) => ({ ...x, node: cloneElement(x.node, { no: `${sn}.${ci + 1}` }) }));
        return (
          <details className="hostel hostel-tile" key={`${top1.godownId}|${top1.hostelCode}`}>
            <summary className="hostel-head">
              <span className="hostel-title"><span className="serial" aria-label={`Number ${sn}`}>{sn}</span><span><span className="hostel-name">{hostelLabel(top1.hostelName)}</span><span className="where">{top1.districtName} district<span className="hid">Hostel ID {top1.hostelCode}</span></span></span></span>
              <span className="hostel-meta">
                <span className="issue-types">{[duplicates.length ? 'Duplicate request' : '', orders.length ? 'Whole-order anomaly' : '', typing.length ? 'Typing mistake' : '', spikes.length ? 'Unusual quantity' : ''].filter(Boolean).join(' / ')}</span>
                <span className={`pill ${sev}`}>{SEVERITY[sev].label}</span>
                <span className="count-chip">{cards.length} {cards.length === 1 ? 'issue' : 'issues'}</span>
                <Icon name="chevron" size={16} />
              </span>
            </summary>
            <p className="tile-profile"><Link href={`/hostel/${top1.hostelCode}?g=${top1.godownId}`} className="link-arrow">See all months<Icon name="arrow" size={15} /></Link></p>
            {numbered.slice(0, CARDS_SHOWN).map((x) => x.node)}
            {cards.length > CARDS_SHOWN && (
              <details className="more">
                <summary><Icon name="chevron" size={18} />Show {cards.length - CARDS_SHOWN} more for this hostel</summary>
                {numbered.slice(CARDS_SHOWN).map((x) => x.node)}
              </details>
            )}
          </details>
        );
      })}
      {pages > 1 && (
        <nav className="pager" aria-label="More hostels">
          {pageNo > 1 ? <Link className="btn" href={qs(sp, { p: pageNo === 2 ? '' : String(pageNo - 1) })}>Previous</Link> : <span />}
          <span className="mut">Hostels {offset + 1} to {Math.min(offset + PAGE_SIZE, groups.length)} of {groups.length}</span>
          {pageNo < pages ? <Link className="btn primary-ish" href={qs(sp, { p: String(pageNo + 1) })}>Next {Math.min(PAGE_SIZE, groups.length - offset - PAGE_SIZE)} hostels</Link> : <span />}
        </nav>
      )}
    </>
  );
}
