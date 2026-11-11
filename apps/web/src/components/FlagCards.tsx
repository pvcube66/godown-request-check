import { BANNER, itemLabel, monthLabel, num, SEVERITY, timesMore } from '@/lib/format';
import type { History } from '@/lib/history';
import { hostelKey, monthsWithRequests } from '@/lib/history';
import { seriesFor } from '@/lib/hostel';
import type { TypingGroup } from '@/lib/group';
import type { AnomalyDoc } from '@anomaly/core';
import FlagActions from './FlagActions';
import { unitFor, withUnit, type UnitMap } from '@/lib/units';
import HistoryChart, { windowMonths } from './HistoryChart';
import { Icon } from './Icons';

interface Ctx { history: History; months: string[]; view: 'open' | 'confirmed' | 'fine'; showActions?: boolean; issues?: Record<string, string>; units?: UnitMap }

function chartFor(a: AnomalyDoc, ctx: Ctx) {
  const h = ctx.history[hostelKey(a.godownId, a.hostelCode)];
  const shown = windowMonths(ctx.months, a.month);
  const have = monthsWithRequests(h);
  const series = seriesFor(h, a.item);
  if (!(series[a.month]! > 0) && a.requested > 0) series[a.month] = a.requested;   // the flag itself says what was asked; the chart must agree with the card
  const earlierMonths = [...have].filter((m) => m < a.month).sort();
  const earlier = earlierMonths.length;
  return {
    shown,
    earlierList: earlierMonths.map((m) => ({ m, q: series[m] ?? 0 })),
    node: <HistoryChart itemName={itemLabel(a.item)} months={shown} values={series} flagMonth={a.month} peer={a.peer?.typical ?? (a.method === 'peers' ? a.expected : undefined)} suffix={unitFor(a.item, ctx.units ?? {}) ? ` ${unitFor(a.item, ctx.units ?? {})}` : ''} />,
    note: earlier >= 3 ? null : earlier === 0
      ? 'This hostel has no earlier months on record yet, so we compared it with similar hostels.'
      : `Only ${earlier} earlier month${earlier > 1 ? 's are' : ' is'} on record for this hostel so far.`,
  };
}

function Key({ peer }: { peer: boolean }) {
  return (
    <ul className="key" aria-label="Chart legend">
      <li><i className="k-ok" />Normal months</li>
      <li><i className="k-bad" />Unusual month</li>
      {peer && <li><i className="k-peer" />What similar hostels ask</li>}
    </ul>
  );
}

/** Side by side: what this hostel asked for, what it asked before, and what similar hostels ask. */
function Compare({ a, earlier, unit = '' }: { a: AnomalyDoc; earlier: { m: string; q: number }[]; unit?: string }) {
  const q = (n: number) => withUnit(num(n), unit);
  const peer = a.peer;
  const byStudents = peer?.basis === 'students';
  return (
    <dl className="compare" aria-label="Comparison">
      <div className="cmp bad"><dt><i />This hostel asked for</dt>
        <dd><b>{q(a.requested)}</b> in {monthLabel(a.month)}{a.students ? <span className="mut"> This hostel has {a.students.toLocaleString('en-IN')} students.</span> : null}</dd></div>
      <div className="cmp ok"><dt><i />This hostel's earlier months</dt>
        <dd>{earlier.length ? earlier.map((e) => `${monthLabel(e.m, true).replace(/\s\d{4}$/, '')}: ${q(e.q)}`).join(',  ') : <span className="mut">None on record yet</span>}</dd></div>
      {peer ? (
        <div className="cmp peer"><dt><i />{byStudents ? 'Hostels of a similar size ask for' : 'Other hostels ask for'}</dt>
          <dd><b>about {q(peer.typical)}</b>
            <span className="mut"> Most ask between {q(peer.low)} and {q(peer.high)}.{' '}
              {byStudents
                ? <>Compared with the {peer.count} hostels closest in size ({peer.sizeRange ? `${num(peer.sizeRange[0])} to ${num(peer.sizeRange[1])}` : 'a similar number of'} students), worked out per student. Hostels that did not ask for this item are left out.{peer.count < 15 ? ' This is a smaller group, so treat the range as a rough guide.' : ''}</>
                : <>This is an estimate. We do not have this hostel's student count, so its size was judged from its other orders.</>}
            </span></dd></div>
      ) : a.method === 'peers' ? (
        <div className="cmp peer"><dt><i />Other hostels ask for</dt><dd><b>about {q(a.expected)}</b></dd></div>
      ) : null}
    </dl>
  );
}

const mode = (v: Ctx['view']) => v;

export function SpikeCard({ a, ctx, no }: { a: AnomalyDoc; ctx: Ctx; no?: string }) {
  const sev = SEVERITY[a.severity];
  const ch = chartFor(a, ctx);
  return (
    <article className={`flag sev-${sev.cls}`}>
      <div className="flag-text">
        <header className="flag-head">
          {no && <span className="no" title="Reference number for this flag">{no}</span>}
          <h3>{itemLabel(a.item)}</h3>
          <span className={`pill ${sev.cls}`}><Icon name={a.severity === 'low' ? 'info' : 'alert'} size={14} />{sev.label}</span>
          <span className="when">for {monthLabel(a.month)}</span>
        </header>
        <p className="sentence">
          That is <b>{timesMore(a.ratio)}</b> than {a.method === 'own-history' ? 'this hostel usually asks for' : a.peer?.basis === 'students' ? 'hostels with a similar number of students ask for' : 'other hostels ask for'}.
        </p>
        <Compare a={a} earlier={ch.earlierList} unit={unitFor(a.item, ctx.units ?? {})} />
        {a.looksLikeExtraZero && (
          <p className="hint"><Icon name="pencil" size={16} />
            <span>{a.zeroFix
              ? <>If {a.zeroFix.divisor === 10 ? 'one zero' : a.zeroFix.divisor === 100 ? 'two zeros' : 'three zeros'} were typed by mistake, the amount would be <b>{num(a.zeroFix.value)}</b>, which is a normal amount for this item.</>
              : <>A zero may have been typed by mistake.</>}</span>
          </p>
        )}
        {ctx.showActions !== false && <FlagActions keys={[a.key]} mode={mode(ctx.view)} issueId={ctx.issues?.[a.key]} />}
      </div>
      <figure className="flag-chart">
        <figcaption>Month by month</figcaption>
        {ch.node}
        <Key peer={!!(a.peer || a.method === 'peers')} />
        {ch.note && <p className="chart-note"><Icon name="info" size={14} />{ch.note}</p>}
      </figure>
    </article>
  );
}

export function TypingCard({ g, ctx, no }: { g: TypingGroup; ctx: Ctx; no?: string }) {
  const [first, ...rest] = g.items.sort((a, b) => b.ratio - a.ratio);
  const ch = chartFor(first!, ctx);
  return (
    <article className="flag sev-high typing">
      <div className="flag-text">
        <header className="flag-head">
          {no && <span className="no" title="Reference number for this flag">{no}</span>}
          <h3>Possible typing mistake</h3>
          <span className="pill high"><Icon name="pencil" size={14} />Check now</span>
          <span className="when">for {monthLabel(g.month)}</span>
        </header>
        <p className="sentence">
          The same number, <b>{num(g.value)}</b>, was entered for <b>{g.items.length} different items</b>. For each one it is far more than usual, so it may have been typed into every box by mistake.
        </p>
        <ul className="chips" aria-label="Items with the same number">
          {g.items.map((a) => <li key={a.key}><b>{itemLabel(a.item)}</b><span>{a.method === 'peers' ? 'similar hostels ask' : 'usually'} {num(a.expected)}</span></li>)}
        </ul>
        {ctx.showActions !== false && <FlagActions keys={g.items.map((a) => a.key)} mode={mode(ctx.view)} issueId={ctx.issues?.[g.items[0]!.key]} />}
      </div>
      <figure className="flag-chart">
        <figcaption>{itemLabel(first!.item)}, month by month</figcaption>
        {ch.node}
        <Key peer={!!(first!.peer || first!.method === 'peers')} />
        {ch.note && <p className="chart-note"><Icon name="info" size={14} />{ch.note}</p>}
      </figure>
      {rest.length > 0 && (
        <details className="flag-more">
          <summary><Icon name="chevron" size={18} />Show month-by-month charts for {rest.length > 8 ? 'the biggest 8 of the other' : 'the other'} {rest.length} item{rest.length > 1 ? 's' : ''}</summary>
          <div className="mini-grid">
            {rest.slice(0, 8).map((a) => (
              <figure key={a.key} className="mini"><figcaption>{itemLabel(a.item)}</figcaption>{chartFor(a, ctx).node}<Key peer={!!(a.peer || a.method === 'peers')} /></figure>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}

/** One finding for the whole order: the typical item is far above what similar-sized hostels ask per student. */
export function OrderCard({ a, items, ctx, no }: { a: AnomalyDoc; items: AnomalyDoc[]; ctx: Ctx; no?: string }) {
  const sev = SEVERITY[a.severity];
  const n = a.order?.itemsCompared ?? items.length;
  const hist = a.order?.history ?? [];
  const values = Object.fromEntries(hist.map((h) => [h.month, h.ratio]));
  const shown = windowMonths(hist.map((h) => h.month), a.month);
  const earlier = hist.filter((h) => h.month < a.month);
  return (
    <article className={`flag sev-${sev.cls} order`}>
      <div className="flag-text">
        <header className="flag-head">
          {no && <span className="no" title="Reference number for this flag">{no}</span>}
          <h3>The whole order looks too big</h3>
          <span className={`pill ${sev.cls}`}><Icon name="alert" size={14} />{sev.label}</span>
          <span className="when">for {monthLabel(a.month)}</span>
        </header>
        <p className="sentence">
          Across <b>{n} items</b>, this hostel asked for <b>{timesMore(a.ratio).replace(' more', '')}</b> what hostels with a similar number of students ask.
        </p>
        <dl className="compare" aria-label="Comparison">
          <div className="cmp bad"><dt><i />This hostel asked for</dt>
            <dd><b>{num(a.ratio)}×</b> the normal order<span className="mut"> in {monthLabel(a.month)}.{a.students ? ` It has ${a.students.toLocaleString('en-IN')} students.` : ''}</span></dd></div>
          <div className="cmp ok"><dt><i />This hostel's earlier months</dt>
            <dd>{earlier.length ? earlier.map((e) => `${monthLabel(e.month, true).replace(/\s\d{4}$/, '')}: ${num(e.ratio)}×`).join(',  ') : <span className="mut">None on record yet</span>}</dd></div>
          <div className="cmp peer"><dt><i />Hostels with a similar number of students</dt>
            <dd><b>1×</b><span className="mut"> This is the normal level. Worked out per student, across {n} items.</span></dd></div>
        </dl>
        <p className="hint"><Icon name="info" size={16} /><span>If this hostel really has more students than the portal shows, the order may be fine. Worth a quick check either way.</span></p>
        {ctx.showActions !== false && <FlagActions keys={[a.key, ...items.map((i) => i.key)]} mode={mode(ctx.view)} issueId={ctx.issues?.[a.key]} />}
      </div>
      <figure className="flag-chart">
        <figcaption>Whole order, month by month</figcaption>
        {shown.length > 0
          ? <HistoryChart itemName="Whole order" months={shown} values={values} flagMonth={a.month} peer={1} suffix="×" peerLabel="Similar hostels" />
          : <p className="chart-note">No earlier months to show yet.</p>}
        <ul className="key" aria-label="Chart legend">
          <li><i className="k-ok" />Normal months</li><li><i className="k-bad" />Unusual month</li><li><i className="k-peer" />Normal for the size (1×)</li>
        </ul>
        <p className="chart-note"><Icon name="info" size={14} />Each bar shows how many times the normal order for this many students the hostel asked for.</p>
      </figure>
      {items.length > 0 && (
        <details className="flag-more">
          <summary><Icon name="chevron" size={18} />Show the {Math.min(items.length, 6)} item{Math.min(items.length, 6) > 1 ? 's' : ''} that stand out most, each with its own earlier months</summary>
          <div className="nested">{items.slice(0, 6).map((i) => <SpikeCard key={i.key} a={i} ctx={{ ...ctx, showActions: false }} />)}</div>
        </details>
      )}
    </article>
  );
}

type ReqInfo = { requestId: string; requestDate: string; status: string; items: Record<string, number> };

/** Two requests from the same hostel and month that are almost identical: one may have been raised twice by mistake.
 *  Shows the real request numbers, dates and statuses, and what is actually in each order. */
export function DuplicateCard({ a, ctx, no, reqs = {} }: { a: AnomalyDoc; ctx: Ctx; no?: string; reqs?: Record<string, ReqInfo> }) {
  const sev = SEVERITY[a.severity];
  const d = a.dup!;
  const pct = Math.round(d.similarity * 100);
  const [A, B] = [reqs[d.requestIds[0]], reqs[d.requestIds[1]]];
  const when = (x?: string) => (x ? x.split('-').reverse().join('-') : 'a date we could not read');
  const nItems = (r?: ReqInfo) => (r ? Object.values(r.items).filter((q) => q > 0).length : d.items);
  const status = (r?: ReqInfo) => (r ? r.status.replace(/_/g, ' ') : '');
  // every item either request asks for, biggest first
  const names = [...new Set([...Object.keys(A?.items ?? {}), ...Object.keys(B?.items ?? {})])]
    .filter((n) => (A?.items[n] ?? 0) > 0 || (B?.items[n] ?? 0) > 0)
    .sort((x, y) => Math.max(B?.items[y] ?? 0, A?.items[y] ?? 0) - Math.max(B?.items[x] ?? 0, A?.items[x] ?? 0));
  const line = (n: string) => {
    const x = A?.items[n] ?? 0, y = B?.items[n] ?? 0;
    return <li key={n} className={x === y ? '' : 'differs'}><span>{itemLabel(n)}</span><b>{x > 0 ? num(x) : '–'}</b><b>{y > 0 ? num(y) : '–'}</b></li>;
  };
  return (
    <article className={`flag sev-${sev.cls} dup`}>
      <div className="flag-text">
        <header className="flag-head">
          {no && <span className="no" title="Reference number for this flag">{no}</span>}
          <h3>Possible duplicate request</h3>
          <span className={`pill ${sev.cls}`}><Icon name="alert" size={14} />{sev.label}</span>
          <span className="when">for {monthLabel(a.month)}</span>
        </header>
        <p className="sentence">
          Two requests from this hostel are <b>{pct}% the same</b> across <b>{d.items} items</b>. One of them may have been raised twice by mistake.
        </p>
        <dl className="compare" aria-label="The two requests">
          <div className="cmp ok"><dt><i />First request</dt><dd><b>{d.requestIds[0]}</b><span className="mut"> placed on {when(A?.requestDate || d.dates[0])}. {status(A)}. {nItems(A)} items.</span></dd></div>
          <div className="cmp bad"><dt><i />Second request</dt><dd><b>{d.requestIds[1]}</b><span className="mut"> placed on {when(B?.requestDate || d.dates[1])}. {status(B)}. {nItems(B)} items.</span></dd></div>
        </dl>
        {names.length > 0 && (
          <div className="dup-order">
            <p className="dup-title">What is in the two orders <span className="mut">(amounts that differ are highlighted)</span></p>
            <div className="dup-head"><span>Item</span><b>First</b><b>Second</b></div>
            <ul className="dup-items">{names.slice(0, 8).map(line)}</ul>
            {names.length > 8 && (
              <details className="dup-more"><summary><Icon name="chevron" size={16} />Show the other {names.length - 8} items</summary><ul className="dup-items">{names.slice(8).map(line)}</ul></details>
            )}
          </div>
        )}
        <p className="hint"><Icon name="info" size={16} /><span>If it is a duplicate, the second request can be cancelled before it is delivered. Until then, both are counted in this hostel's totals, because that is what it would receive, so some items may also be flagged as too high.</span></p>
        {ctx.showActions !== false && <FlagActions keys={[a.key]} mode={mode(ctx.view)} issueId={ctx.issues?.[a.key]} />}
      </div>
    </article>
  );
}
