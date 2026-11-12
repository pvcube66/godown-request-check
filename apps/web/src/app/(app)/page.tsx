import { Suspense, cloneElement } from 'react';
import Link from 'next/link';
import { PageLoader } from '@/components/Loader';
import { getDb } from '@/lib/db';
import { scopeFor } from '@/lib/viewer';
import { overdueCount } from '@/lib/issues';
import { loadUnits, unitFor, withUnit } from '@/lib/units';
import { loadHealth, STALE_MINUTES } from '@/lib/health';
import { ago, hostelLabel, itemLabel, monthLabel, num, SEVERITY, timesMore } from '@/lib/format';
import { groupFlags } from '@/lib/group';
import { loadFlagRequestIds, loadHistory, loadHostelPhones, loadOrderItems, loadRequestsById } from '@/lib/history';
import { loadItemNames } from '@/lib/item-names';
import { searchFilter, searchQuery } from '@/lib/search';
import { DuplicateCard, OrderCard, SpikeCard, TypingCard } from '@/components/FlagCards';
import { Icon } from '@/components/Icons';
import FilterSelect from './FilterSelect';
import { scoped, canEdit, getWaitDays, type AnomalyDoc } from '@anomaly/core';

export const dynamic = 'force-dynamic';
type SP = { sev?: string; month?: string; district?: string; view?: string; p?: string; all?: string; q?: string; kind?: string };
/** The kinds of unusual request, as the screen names them. */
const KIND_TABS = [
  { key: '', label: 'All types' },
  { key: 'spike', label: 'Unusual quantity' },
  { key: 'typing', label: 'Same number typed' },
  { key: 'order', label: 'Whole order too big' },
  { key: 'duplicate', label: 'Possible duplicate' },
] as const;
const PAGE_SIZE = 12, CARDS_SHOWN = 3;
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
  return <Suspense key={JSON.stringify(sp)} fallback={<PageLoader />}><HomeContent sp={sp} /></Suspense>;
}

async function HomeContent({ sp }: { sp: SP }) {
  const sev = (['high', 'medium', 'low'] as const).includes(sp.sev as 'high') ? (sp.sev as 'high' | 'medium' | 'low') : 'high';
  const view = (['open', 'confirmed', 'fine'].includes(sp.view ?? '') ? sp.view! : 'open') as 'open' | 'confirmed' | 'fine';
  const c = await getDb();
  const { viewer, names } = await scopeFor(c);

  const base0: Record<string, unknown> = { partOfOrder: { $ne: true } };
  if (sp.month) base0.month = sp.month;
  if (sp.district) base0.districtName = sp.district;
  const q = searchQuery(sp.q);
  const sf = searchFilter(q, ['hostelName', 'hostelCode', 'districtName']);
  if (sf) base0.$and = sf.$and;
  const kind = KIND_TABS.find((k) => k.key && k.key === sp.kind)?.key ?? '';
  const scopeAnyKind = scoped({ ...base0 }, names);                 // every type: used for the numbers on the type chips
  if (kind) base0.kind = kind;
  const scope = scoped(base0, names);
  const statusFilter = view === 'fine' ? { $in: ['ignored', 'expected'] } : view;
  const attention = { ...scope, status: 'open', severity: { $in: ['high', 'medium'] } };
  const showSummary = view === 'open';

  // lookups that do not depend on the list start now and run alongside the main queries
  const sideLookups = Promise.all([loadUnits(c), loadItemNames(c), getWaitDays(c).then(async (w) => [w, await overdueCount(c, names, w)] as const), loadHealth(c)]);
  sideLookups.catch(() => { /* reported below, where it is awaited */ });
  const [kindCounts, rows, counts, months, districts, lastRun, requestMonths, allTypesRows] = await Promise.all([
    c.anomalies.aggregate<{ _id: string; n: number }>([{ $match: { ...scopeAnyKind, status: statusFilter, severity: sev } }, { $group: { _id: { k: '$kind', g: '$godownId', h: '$hostelCode' } } }, { $group: { _id: '$_id.k', n: { $sum: 1 } } }]).toArray(),   // hostels, like the cards below
    c.anomalies.find({ ...scope, status: statusFilter, severity: sev } as never).sort({ ratio: -1 }).limit(3000).toArray(),
    c.anomalies.aggregate<{ _id: string; n: number }>([{ $match: { ...scope, status: statusFilter } }, { $group: { _id: { s: '$severity', g: '$godownId', h: '$hostelCode' } } }, { $group: { _id: '$_id.s', n: { $sum: 1 } } }]).toArray(),   // hostels, like the cards below
    c.anomalies.distinct('month', scoped({}, names)),
    c.anomalies.distinct('districtName', scoped({}, names)),
    c.runs.find().sort({ startedAt: -1 }).limit(1).next(),
    c.requests.distinct('month', scoped({}, names)),
    c.anomalies.aggregate<{ n: number }>([{ $match: { ...scopeAnyKind, status: statusFilter, severity: sev } }, { $group: { _id: { g: '$godownId', h: '$hostelCode' } } }, { $count: 'n' }]).toArray(),
  ]);
  const count = (s: string) => counts.find((x) => x._id === s)?.n ?? 0;

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
  const flagKeys = shown.flatMap((g) => g.map((a) => a.key));
  const issueRows = view === 'confirmed' && flagKeys.length ? await c.issues.find(scoped({ anomalyKeys: { $in: flagKeys } }, names), { projection: { issueId: 1, anomalyKeys: 1 } }).toArray() : [];
  const issues: Record<string, string> = {};
  for (const i of issueRows) for (const k of i.anomalyKeys) issues[k] = i.issueId;
  const [flagRequests, phones] = await Promise.all([
    loadFlagRequestIds(c, shown.map((g) => ({ godownId: g[0]!.godownId, hostelCode: g[0]!.hostelCode, month: g[0]!.month }))),
    loadHostelPhones(c, shown.map((g) => ({ godownId: g[0]!.godownId, hostelCode: g[0]!.hostelCode }))),
  ]);
  const [units, itemNames, [waitDays, overdue], health] = await sideLookups;
  const ctx = { history, months: allMonths, view, showActions: canEdit(viewer), issues, units, names: itemNames };

  const base = Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>;
  const reportQuery = new URLSearchParams(Object.entries({ month: sp.month ?? '', district: sp.district ?? '', q }).filter(([, v]) => v) as [string, string][]).toString();
  const hour = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: IST }));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLine = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: IST });
  const headline = view === 'open'
    ? groups.length ? `${groups.length} hostel${groups.length > 1 ? 's' : ''} ${HEADLINE[sev]}` : q ? `No match for “${q}”` : 'All clear'
    : view === 'confirmed' ? 'Requests with an issue raised' : 'Requests you marked as fine';
  const checkedOk = lastRun?.ok;

  return (
    <>
      <section className="hero">
        <h1>{headline}</h1>
        <p className={`status ${checkedOk === false ? 'bad' : ''}`}>
          <span className="live" aria-hidden="true" />
          {lastRun ? <>Last checked {ago(lastRun.startedAt)}.{health.ok ? <> Next check at {nextCheck().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST })}.</> : <> Automatic checking is not running right now.</>}</> : 'No check has run yet.'}
          {checkedOk === false && <b> The last check had a problem.</b>}
        </p>
      </section>

      {!health.ok && <p className="alert-bar" role="alert">The hourly check has not worked for over {STALE_MINUTES / 60} hours{health.lastSuccessAt ? <> (last good check {ago(health.lastSuccessAt)})</> : ' (no good check on record)'}. The lists below may be out of date. Please tell an administrator.</p>}
      {viewer.role === 'admin' && health.needAttention > 0 && <p className="alert-bar" role="alert">{health.needAttention} godown {health.needAttention === 1 ? 'login needs' : 'logins need'} attention (portal sign-in failing). <Link href="/accounts">See Godowns</Link></p>}
      {overdue > 0 && <p className="alert-bar" role="status">{overdue} {overdue === 1 ? 'hostel has' : 'hostels have'} not sent a new indent {waitDays}+ {waitDays === 1 ? 'day' : 'days'} after a rejection. <Link href="/issues">See the list</Link></p>}

      <nav className="sev-seg" aria-label="How big is the difference">
        {(['high', 'medium', 'low'] as const).map((s) => (
          <Link key={s} href={qs(sp, { sev: s, p: '' })} className={`sev-opt ${s} ${sev === s ? 'on' : ''}`} aria-current={sev === s ? 'page' : undefined}>
            <i className="dot" aria-hidden="true" />{SEVERITY[s].label}<b>{count(s)}</b>
          </Link>
        ))}
      </nav>

      <div className="filters">
        <FilterSelect label="Month" name="month" value={sp.month ?? ''} base={base} options={[{ value: '', label: 'All months' }, ...months.sort().reverse().map((m) => ({ value: m, label: monthLabel(m) }))]} />
        {districts.length > 1 && <FilterSelect label="District" name="district" value={sp.district ?? ''} base={base} options={[{ value: '', label: 'All districts' }, ...districts.sort().map((d) => ({ value: d, label: d }))]} />}
        <Link href={`/report/csv${reportQuery ? `?${reportQuery}` : ''}`} className="link-arrow dl-link"><Icon name="download" size={16} />Excel</Link>
        <div className="seg" role="group" aria-label="Which requests to show">
          {[['open', 'To check'], ['confirmed', 'Issues raised'], ['fine', 'Marked fine']].map(([v, l]) => (
            <Link key={v} href={qs(sp, { view: v === 'open' ? '' : v, p: '' })} className={view === v ? 'on' : ''} aria-current={view === v ? 'page' : undefined}>{l}</Link>
          ))}
        </div>
      </div>

      <nav className="type-chips" aria-label="Type of unusual request">
        {KIND_TABS.map((k) => {
          const n = k.key ? (kindCounts.find((x) => x._id === k.key)?.n ?? 0) : allTypesRows[0]?.n ?? 0;
          return (
            <Link key={k.key || 'all'} href={qs(sp, { kind: k.key, p: '' })} className={`type-chip ${kind === k.key ? 'on' : ''} ${k.key ? `k-${k.key}` : ''}`} aria-current={kind === k.key ? 'page' : undefined}>
              <i className="dot" aria-hidden="true" />{k.label}<span className="type-n">{n}</span>
            </Link>
          );
        })}
      </nav>


      {groups.length === 0 && (
        <div className="empty">
          <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="34" fill="var(--surface)" /><path d="M23 37l9 9 18-20" fill="none" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <h2>{q ? 'No hostel found' : view === 'open' ? 'Nothing to check here' : 'Nothing here yet'}</h2>
          <p>{q ? `No hostel matching “${q}” has anything in this list.` : view === 'open' ? 'Everything in this group looks normal. Try the other tabs above.' : 'Requests you mark will appear here.'}</p>
        </div>
      )}

      <div className="tile-grid">
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
        const reqIds = flagRequests.get(`${top1.godownId}|${top1.hostelCode}|${top1.month}`) ?? [];
        const phone = phones.get(`${top1.godownId}|${top1.hostelCode}`);
        return (
          <details className={`hostel hostel-tile tile hc sev-${top1.severity}`} key={`${top1.godownId}|${top1.hostelCode}`}>
            <summary className="hc-head">
              <span className="hc-top">
                <span className="hc-no" aria-label={`Number ${sn}`}>{sn}</span>
                <span className="hc-title">
                  <span className="hc-name">{hostelLabel(top1.hostelName)}</span>
                  <span className="hc-meta">{top1.districtName}</span>
                  <span className="hc-chips">
                    <span className="hc-chip" title="Hostel ID"><Icon name="id" size={14} /><span className="hc-chip-label">Hostel ID</span><b>{top1.hostelCode}</b></span>
                    {reqIds.length > 0 && <span className="hc-chip" title="Request ID"><Icon name="file" size={14} /><span className="hc-chip-label">Request</span><b>{reqIds.slice(0, 2).join(', ')}</b>{reqIds.length > 2 && <span className="hc-chip-more">+{reqIds.length - 2} more</span>}</span>}
                    {phone && <a className="hc-chip hc-call" href={`tel:${phone.replace(/[^+0-9]/g, '')}`} title="Call the hostel"><Icon name="phone" size={14} /><span className="hc-chip-label">Call</span><b>{phone}</b></a>}
                  </span>
                </span>
                <Icon name="chevron" size={16} />
              </span>
              <span className="hc-body">
                {top1.kind === 'duplicate' ? (
                  <>
                    <span className="hc-fig"><b>{Math.round((top1.dup?.similarity ?? 0) * 100)}%</b><small>alike</small></span>
                    <span className="hc-detail">
                      <span className="hc-line">Two requests that look the same</span>
                      {top1.dup?.items ? <span className="hc-sub">{top1.dup.items} items match</span> : null}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="hc-fig">
                      <b>{top1.ratio >= 1000 ? '999+' : top1.ratio >= 10 ? Math.round(top1.ratio).toLocaleString('en-IN') : top1.ratio.toFixed(1).replace(/\.0$/, '')}×</b>
                      <small>{top1.kind === 'order' || top1.expected <= 0 ? 'bigger than similar hostels' : 'the usual amount'}</small>
                    </span>
                    <span className="hc-detail">
                      <span className="hc-line">{top1.kind === 'order' ? 'Whole order' : itemLabel(top1.item, itemNames)}</span>
                      {top1.kind !== 'order' && top1.expected > 0 && (
                        <span className="hc-sub">Usually {withUnit(num(top1.expected), unitFor(top1.item, units))} · asked <b>{withUnit(num(top1.requested), unitFor(top1.item, units))}</b></span>
                      )}
                      {top1.kind === 'order' && <span className="hc-sub">Asked <b>{withUnit(num(top1.requested), unitFor(top1.item, units))}</b> in total</span>}
                    </span>
                  </>
                )}
              </span>
              <span className="hc-foot">
                <span className="hc-problems">
                  {[duplicates.length && 'Possible duplicate', orders.length && 'Whole order too big', typing.length && 'Same number typed', spikes.length && 'Unusual quantity'].filter(Boolean).slice(0, 2).map((t) => <span key={t as string}>{t}</span>)}
                  {[duplicates.length, orders.length, typing.length, spikes.length].filter(Boolean).length > 2 && <span>+ more</span>}
                </span>
                {cards.length > 1 && <span className="hc-count">{cards.length} issues</span>}
              </span>
            </summary>
            <p className="tile-profile">
              <Link href={`/hostel/${top1.hostelCode}?g=${top1.godownId}`} className="link-arrow">See all months<Icon name="arrow" size={15} /></Link>
              {reqIds.map((id) => <Link key={id} href={`/orders/${encodeURIComponent(id)}`} className="link-arrow">Order {id}<Icon name="arrow" size={15} /></Link>)}
            </p>
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
      </div>
      {pages > 1 && (
        <nav className="pager-bar" aria-label="Pages of hostels">
          <span className="mut">Showing {offset + 1} to {Math.min(offset + PAGE_SIZE, groups.length)} of {groups.length} hostels</span>
          <div className="pager-ctrl">
            {pageNo > 1
              ? <Link className="pager-btn" href={qs(sp, { p: pageNo === 2 ? '' : String(pageNo - 1) })} rel="prev"><Icon name="chevronLeft" size={16} /> Previous</Link>
              : <span className="pager-btn off" aria-disabled="true"><Icon name="chevronLeft" size={16} /> Previous</span>}
            <span className="pager-page">Page {pageNo} of {pages}</span>
            {pageNo < pages
              ? <Link className="pager-btn" href={qs(sp, { p: String(pageNo + 1) })} rel="next">Next <Icon name="chevronRight" size={16} /></Link>
              : <span className="pager-btn off" aria-disabled="true">Next <Icon name="chevronRight" size={16} /></span>}
          </div>
        </nav>
      )}
    </>
  );
}
