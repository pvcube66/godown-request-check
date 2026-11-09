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
                ? <>Compared with {peer.count} hostels that have {peer.sizeRange ? `${num(peer.sizeRange[0])} to ${num(peer.sizeRange[1])}` : 'a similar number of'} students, worked out per student.</>
                : <>This is an estimate. We do not have this hostel's student count, so its size was judged from its other orders.</>}
            </span></dd></div>
      ) : a.method === 'peers' ? (
        <div className="cmp peer"><dt><i />Other hostels ask for</dt><dd><b>about {num(a.expected)}</b></dd></div>
      ) : null}
    </dl>
  );
}

const mode = (v: Ctx['view']) => (v === 'open' ? 'open' : 'done');

export function SpikeCard({ a, ctx }: { a: AnomalyDoc; ctx: Ctx }) {
  const sev = SEVERITY[a.severity];
  const ch = chartFor(a, ctx);
  return (
    <article className={`flag sev-${sev.cls}`}>
      <div className="flag-text">
        <header className="flag-head">
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

export function TypingCard({ g, ctx }: { g: TypingGroup; ctx: Ctx }) {
  const [first, ...rest] = g.items.sort((a, b) => b.ratio - a.ratio);
  const ch = chartFor(first!, ctx);
  return (
    <article className="flag sev-high typing">
      <div className="flag-text">
        <header className="flag-head">
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
          <summary><Icon name="chevron" size={18} />Show month-by-month charts for the other {rest.length} item{rest.length > 1 ? 's' : ''}</summary>
          <div className="mini-grid">
            {rest.map((a) => (
              <figure key={a.key} className="mini"><figcaption>{itemLabel(a.item)}</figcaption>{chartFor(a, ctx).node}<Key peer={!!(a.peer || a.method === 'peers')} /></figure>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}

/** One finding for the whole order: the typical item is far above what similar-sized hostels ask per student. */
export function OrderCard({ a, items, ctx }: { a: AnomalyDoc; items: AnomalyDoc[]; ctx: Ctx }) {
  const sev = SEVERITY[a.severity];
  const n = a.order?.itemsCompared ?? items.length;
  const pct = Math.max(3, Math.min(100, 100 / a.ratio));
  return (
    <article className={`flag sev-${sev.cls} order`}>
      <div className="flag-text">
        <header className="flag-head">
          <h3>The whole order looks too big</h3>
          <span className={`pill ${sev.cls}`}><Icon name="alert" size={14} />{sev.label}</span>
          <span className="when">for {monthLabel(a.month)}</span>
        </header>
        <p className="sentence">
          Across <b>{n} items</b>, this hostel asked for <b>{timesMore(a.ratio).replace(' more', '')}</b> what hostels with a similar number of students ask.
          {a.students ? <> It has <b>{a.students.toLocaleString('en-IN')} students</b>.</> : null}
        </p>
        <p className="hint"><Icon name="info" size={16} />If this hostel really has more students than the portal shows, the order may be fine. Worth a quick check either way.</p>
        {ctx.showActions !== false && <FlagActions keys={[a.key, ...items.map((i) => i.key)]} mode={mode(ctx.view)} />}
      </div>
      <figure className="flag-chart">
        <figcaption>Per student, compared with similar hostels</figcaption>
        <div className="bars" role="img" aria-label={`Similar hostels 1, this hostel about ${a.ratio} times that`}>
          <div className="bar-row"><span>Similar hostels</span><div className="track"><i className="b-ref" style={{ width: `${pct}%` }} /></div><b>1×</b></div>
          <div className="bar-row"><span>This hostel</span><div className="track"><i className="b-high" style={{ width: '100%' }} /></div><b>{num(a.ratio)}×</b></div>
        </div>
      </figure>
      {items.length > 0 && (
        <details className="flag-more">
          <summary><Icon name="chevron" size={18} />Show the {items.length} item{items.length > 1 ? 's' : ''} that stand out most</summary>
          <div className="nested">{items.slice(0, 12).map((i) => <SpikeCard key={i.key} a={i} ctx={{ ...ctx, showActions: false }} />)}</div>
        </details>
      )}
    </article>
  );
}
