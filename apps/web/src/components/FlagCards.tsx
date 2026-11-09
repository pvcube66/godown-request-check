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
  const earlier = [...have].filter((m) => m < a.month).length;
  return {
    shown,
    node: <HistoryChart itemName={itemLabel(a.item)} months={shown} values={h?.[a.item] ?? {}} flagMonth={a.month} expected={a.expected} sev={a.severity} />,
    note: earlier >= 3 ? null : earlier === 0
      ? 'This hostel has no earlier months on record yet, so we compared it with similar hostels.'
      : `Only ${earlier} earlier month${earlier > 1 ? 's are' : ' is'} on record for this hostel so far.`,
  };
}

function Legend({ expected }: { expected: number }) {
  return <p className="legend"><i aria-hidden="true" />Dashed line: the usual amount, about <b>{num(expected)}</b></p>;
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
          Asked for <b>{num(a.requested)}</b>. Usually about <b>{num(a.expected)}</b>, so this is <b>{timesMore(a.ratio)}</b>.
        </p>
        {a.looksLikeExtraZero && (
          <p className="hint"><Icon name="pencil" size={16} />The jump is almost exactly {a.ratio >= 500 ? '1,000' : a.ratio >= 50 ? '100' : '10'} times. A zero may have been typed by mistake.</p>
        )}
        <p className="why">{a.method === 'own-history' ? 'Compared with what this hostel asked for in earlier months.' : 'Compared with similar hostels.'}</p>
        {ctx.showActions !== false && <FlagActions keys={[a.key]} mode={mode(ctx.view)} />}
      </div>
      <figure className="flag-chart">
        <figcaption>Month by month</figcaption>
        {ch.node}
        <Legend expected={a.expected} />
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
          {g.items.map((a) => <li key={a.key}><b>{itemLabel(a.item)}</b><span>usually {num(a.expected)}</span></li>)}
        </ul>
        {ctx.showActions !== false && <FlagActions keys={g.items.map((a) => a.key)} mode={mode(ctx.view)} />}
      </div>
      <figure className="flag-chart">
        <figcaption>{itemLabel(first!.item)}, month by month</figcaption>
        {ch.node}
        <Legend expected={first!.expected} />
        {ch.note && <p className="chart-note"><Icon name="info" size={14} />{ch.note}</p>}
      </figure>
      {rest.length > 0 && (
        <details className="flag-more">
          <summary><Icon name="chevron" size={18} />Show month-by-month charts for the other {rest.length} item{rest.length > 1 ? 's' : ''}</summary>
          <div className="mini-grid">
            {rest.map((a) => (
              <figure key={a.key} className="mini"><figcaption>{itemLabel(a.item)}</figcaption>{chartFor(a, ctx).node}<Legend expected={a.expected} /></figure>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}
