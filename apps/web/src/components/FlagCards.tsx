import { itemLabel, monthLabel, num, SEVERITY, timesMore } from '@/lib/format';
import type { History } from '@/lib/history';
import { hostelKey, monthsWithRequests } from '@/lib/history';
import type { TypingGroup } from '@/lib/group';
import type { AnomalyDoc } from '@anomaly/core';
import FlagActions from './FlagActions';
import HistoryChart, { windowMonths } from './HistoryChart';
import { Icon } from './Icons';

interface Ctx { history: History; months: string[]; view: 'open' | 'confirmed' | 'fine'; showActions?: boolean }

function chartFor(a: AnomalyDoc, ctx: Ctx) {
  const h = ctx.history[hostelKey(a.godownId, a.hostelCode)];
  const shown = windowMonths(ctx.months, a.month);
  const have = monthsWithRequests(h);
  const earlierMonths = [...have].filter((m) => m < a.month).sort();
  const earlier = earlierMonths.length;
  return {
    shown,
    earlierList: earlierMonths.map((m) => ({ m, q: h?.[a.item]?.[m] ?? 0 })),
    node: <HistoryChart itemName={itemLabel(a.item)} months={shown} values={h?.[a.item] ?? {}} flagMonth={a.month} peer={a.peer?.typical ?? (a.method === 'peers' ? a.expected : undefined)} />,
    note: earlier >= 3 ? null : earlier === 0
      ? 'This hostel has no earlier months on record yet, so we compared it with similar hostels.'
      : `Only ${earlier} earlier month${earlier > 1 ? 's are' : ' is'} on record for this hostel so far.`,
  };
}

function Key({ peer }: { peer: boolean }) {
  return (
    <ul className="key" aria-label="What the colours mean">
      <li><i className="k-ok" />Normal months</li>
      <li><i className="k-bad" />Unusual month</li>
      {peer && <li><i className="k-peer" />What similar hostels ask</li>}
    </ul>
  );
}

/** Side by side: what this hostel asked for, what it asked before, and what similar hostels ask. */
function Compare({ a, earlier }: { a: AnomalyDoc; earlier: { m: string; q: number }[] }) {
  const peer = a.peer;
  const byStudents = peer?.basis === 'students';
  return (
    <dl className="compare" aria-label="Comparison">
      <div className="cmp bad"><dt><i />This hostel asked for</dt>
        <dd><b>{num(a.requested)}</b> in {monthLabel(a.month)}{a.students ? <span className="mut"> This hostel has {a.students.toLocaleString('en-IN')} students.</span> : null}</dd></div>
      <div className="cmp ok"><dt><i />This hostel's earlier months</dt>
        <dd>{earlier.length ? earlier.map((e) => `${monthLabel(e.m, true).replace(/\s\d{4}$/, '')}: ${num(e.q)}`).join(',  ') : <span className="mut">None on record yet</span>}</dd></div>
      {peer ? (
        <div className="cmp peer"><dt><i />{byStudents ? 'Hostels of a similar size ask for' : 'Other hostels ask for'}</dt>
          <dd><b>about {num(peer.typical)}</b>
            <span className="mut"> Most ask between {num(peer.low)} and {num(peer.high)}.{' '}
              {byStudents
                ? <>Compared with the {peer.count} hostels closest in size ({peer.sizeRange ? `${num(peer.sizeRange[0])} to ${num(peer.sizeRange[1])}` : 'a similar number of'} students), worked out per student. Hostels that did not ask for this item are left out.{peer.count < 15 ? ' This is a smaller group, so treat the range as a rough guide.' : ''}</>
                : <>This is an estimate. We do not have this hostel's student count, so its size was judged from its other orders.</>}
            </span></dd></div>
      ) : a.method === 'peers' ? (
        <div className="cmp peer"><dt><i />Other hostels ask for</dt><dd><b>about {num(a.expected)}</b></dd></div>
      ) : null}
    </dl>
  );
}

const mode = (v: Ctx['view']) => (v === 'open' ? 'open' : 'done');

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
        <Compare a={a} earlier={ch.earlierList} />
        {a.looksLikeExtraZero && (
          <p className="hint"><Icon name="pencil" size={16} />
            <span>{a.zeroFix
              ? <>If {a.zeroFix.divisor === 10 ? 'one zero' : a.zeroFix.divisor === 100 ? 'two zeros' : 'three zeros'} were typed by mistake, the amount would be <b>{num(a.zeroFix.value)}</b>, which is a normal amount for this item.</>
              : <>A zero may have been typed by mistake.</>}</span>
          </p>
        )}
        {ctx.showActions !== false && <FlagActions keys={[a.key]} mode={mode(ctx.view)} />}
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
        {ctx.showActions !== false && <FlagActions keys={g.items.map((a) => a.key)} mode={mode(ctx.view)} />}
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
        {ctx.showActions !== false && <FlagActions keys={[a.key, ...items.map((i) => i.key)]} mode={mode(ctx.view)} />}
      </div>
      <figure className="flag-chart">
        <figcaption>Whole order, month by month</figcaption>
        {shown.length > 0
          ? <HistoryChart itemName="Whole order" months={shown} values={values} flagMonth={a.month} peer={1} suffix="×" peerLabel="Similar hostels" />
          : <p className="chart-note">No earlier months to show yet.</p>}
        <ul className="key" aria-label="What the colours mean">
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

/** Two requests from the same hostel and month that are almost identical: one may have been raised twice by mistake. */
export function DuplicateCard({ a, ctx, no }: { a: AnomalyDoc; ctx: Ctx; no?: string }) {
  const sev = SEVERITY[a.severity];
  const d = a.dup!;
  const pct = Math.round(d.similarity * 100);
  const when = (x: string) => (x ? x.split('-').reverse().join('-') : 'date not shown');
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
          <div className="cmp ok"><dt><i />First request</dt><dd><b>{d.requestIds[0]}</b><span className="mut"> placed on {when(d.dates[0])}</span></dd></div>
          <div className="cmp bad"><dt><i />Second request</dt><dd><b>{d.requestIds[1]}</b><span className="mut"> placed on {when(d.dates[1])}. Almost every amount matches the first.</span></dd></div>
        </dl>
        <p className="hint"><Icon name="info" size={16} /><span>If it is a duplicate, the second request can be cancelled before it is delivered. We have left it out of this hostel's totals so it does not also look like an oversized order.</span></p>
        {ctx.showActions !== false && <FlagActions keys={[a.key]} mode={mode(ctx.view)} />}
      </div>
    </article>
  );
}
