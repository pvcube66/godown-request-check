import Link from 'next/link';
import { canEdit, daysInStage, istDay, OPEN_STAGES, resolveHostelMapping, scoped, STAGE_LABEL } from '@anomaly/core';
import { loadIndent } from '@/lib/indent';
import { loadUnits } from '@/lib/units';
import { monthComparison, monthRange, sameItem, sizeWords } from '@/lib/hostel';
import { daysSincePlaced, fmtDay, STAGE_COLUMNS, stageCells, urgency } from '@/lib/orders';
import { getDb } from '@/lib/db';
import { getViewer, scopeFor, visibleDistricts } from '@/lib/viewer';
import { hostelLabel, itemLabel, monthLabel, num } from '@/lib/format';
import { groupFlags } from '@/lib/group';
import { hostelKey, loadHistory, loadOrderItems, loadRequestsById, monthsWithRequests } from '@/lib/history';
import { DuplicateCard, OrderCard, SpikeCard, TypingCard } from '@/components/FlagCards';
import { Icon } from '@/components/Icons';
import WhatsAppHistory from '@/components/WhatsAppHistory';
import OptOutForm from '../../whatsapp/OptOutForm';
import { ACTIVE_STATES as ACTIVE, STATE_TEXT } from '@anomaly/core';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const c = await getDb(); const { code } = await params;
  const v = await getViewer();
  if (!v) return { title: 'Hostel' };
  const r = await c.requests.findOne(scoped({ hostelCode: code }, await visibleDistricts(c, v)), { projection: { hostelName: 1 } });
  return { title: r ? hostelLabel(r.hostelName) : 'Hostel' };
}

export default async function Hostel({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ g?: string; m?: string }> }) {
  const { code } = await params;
  const { g, m } = await searchParams;
  const c = await getDb();
  const { viewer, names } = await scopeFor(c);
  const filter = { hostelCode: code, ...(g ? { godownId: Number(g) } : {}) };
  const reqs = await c.requests.find(scoped(filter, names)).toArray();
  if (!reqs.length) return (
    <div className="empty"><h2>Hostel not found</h2><p>We could not find any requests for this hostel.</p><Link className="btn" href="/">Back to the list</Link></div>
  );
  const godownId = reqs[0]!.godownId;
  const size = await c.hostels.findOne({ godownId, hostelCode: code });
  const assignment = await resolveHostelMapping(c, { godownId, hostelCode: code }, istDay(new Date()));
  const phone = (value?: string) => value ? <a href={`tel:${value.replace(/[^+0-9]/g, '')}`}>{value}</a> : 'Not recorded';
  const flagged = await c.anomalies.find(scoped({ ...filter, status: 'open' }, names)).sort({ ratio: -1 }).toArray();
  const { history, months: allMonths } = await loadHistory(c, [{ godownId, hostelCode: code }]);
  const h = history[hostelKey(godownId, code)] ?? {};
  const months = [...monthsWithRequests(h)].sort();
  // ---- month picker, indent history, stuck orders, remarks (all limited to this person's districts) ----
  const requestMonths = [...new Set(reqs.map((r) => r.month))].sort();
  const monthList = monthRange(requestMonths);
  const selected = m && monthList.includes(m) ? m : requestMonths[requestMonths.length - 1]!;
  const monthReqs = reqs.filter((r) => r.month === selected).sort((a, b) => a.requestDate.localeCompare(b.requestDate));
  const now = new Date();
  const [monthOrders, hostelOrders, indents] = await Promise.all([
    monthReqs.length ? c.orders.find(scoped({ requestId: { $in: monthReqs.map((r) => r.requestId) } }, names)).toArray() : [],
    c.orders.find(scoped({ hostelCode: code, stage: { $in: OPEN_STAGES } }, names)).toArray(),
    Promise.all(monthReqs.filter((r) => !/^reject/i.test(r.status)).map(async (r) => ({ id: r.requestId, rows: await loadIndent(c, r.requestId) }))),
  ]);
  const orderById = new Map(monthOrders.map((o) => [o.requestId, o]));
  const stuckOrders = hostelOrders.filter((o) => urgency(o, now) !== 'ok').sort((a, b) => daysInStage(b, now) - daysInStage(a, now));
  const unitOf = new Map(indents.flatMap((i) => i.rows).map((r) => [r.name, r]));
  const comparison = monthComparison(h, months, selected);
  const { orders, duplicates, typing, spikes: spikesAll } = groupFlags(flagged);
  const spikes = spikesAll.filter((a) => !a.partOfOrder);
  const orderItems = await loadOrderItems(c, orders);
  const dupReqs = await loadRequestsById(c, duplicates.flatMap((a) => a.dup!.requestIds));
  const ctx = { history, months: allMonths, view: 'open' as const, showActions: canEdit(viewer), units: await loadUnits(c) };
  const whatsapp = await c.whatsappMessages.find(scoped({ hostelCode: code }, names)).sort({ createdAt: -1 }).limit(20).toArray();
  const hostelIssues = await c.issues.find(scoped({ godownId, hostelCode: code }, names)).sort({ raisedAt: -1 }).limit(20).toArray();
  const remarkCounts = hostelIssues.length ? new Map((await c.remarks.aggregate<{ _id: string; n: number }>([{ $match: { targetType: 'issue', targetId: { $in: hostelIssues.map((i) => i.issueId) } } }, { $group: { _id: '$targetId', n: { $sum: 1 } } }]).toArray()).map((r) => [r._id, r.n])) : new Map<string, number>();
  const latestRows = hostelIssues.length ? await c.remarks.aggregate<{ _id: string; text: string }>([{ $match: { targetType: 'issue', targetId: { $in: hostelIssues.map((i) => i.issueId) } } }, { $sort: { at: 1 } }, { $group: { _id: '$targetId', text: { $last: '$text' } } }]).toArray() : [];
  const latestRemark = new Map(latestRows.map((r) => [r._id, r.text.length > 80 ? `${r.text.slice(0, 80)}…` : r.text]));

  const flaggedSet = new Map<string, number>();                       // item|month -> flagged requested
  for (const a of flagged) flaggedSet.set(`${a.item}|${a.month}`, a.requested);
  const hit = new Set([...flaggedSet.keys()].filter((k) => {
    const [item, month] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)];
    const earlier = months.filter((m) => m < month).map((m) => h[item]?.[m] ?? 0);
    return flaggedSet.get(k)! > Math.max(0, ...earlier);
  }));
  const flaggedItems = new Set(flagged.map((a) => a.item));
  const items = Object.keys(h).filter((it) => Object.values(h[it]!).some((q) => q > 0))
    .sort((a, b) => Number(flaggedItems.has(b)) - Number(flaggedItems.has(a)) || a.localeCompare(b));
  const cols = { '--cols': months.length } as React.CSSProperties;
  const nCards = duplicates.length + orders.length + typing.length + spikes.length;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/"><Icon name="back" size={16} />Unusual requests</Link></nav>
      <section className="hero">
        <h1>{hostelLabel(reqs[0]!.hostelName)}</h1>
        <p className="where big"><Icon name="pin" size={17} />{reqs[0]!.districtName} district<span className="hid">Hostel ID {code}</span></p>
        <ul className="facts">
          <li>{size?.students ? <><b>{size.students.toLocaleString('en-IN')}</b> students</> : <span className="mut">Student count not available</span>}</li>
          <li><b>{reqs.length}</b> request{reqs.length > 1 ? 's' : ''} on record</li>
          <li><b>{months.length}</b> month{months.length > 1 ? 's' : ''} of history</li>
          <li className={nCards ? 'warn' : 'good'}><b>{nCards}</b> to look at</li>
        </ul>
      </section>

      <section className="summary" aria-labelledby="hostel-assignment">
        <h2 id="hostel-assignment">Assignment and business contacts</h2>
        <ul>
          <li>Assigned godown: <b>{assignment.godown?.name ?? 'Not mapped for today'}</b></li>
          <li>Supplier: <b>{assignment.supplier?.name ?? 'Not mapped for today'}</b></li>
          <li>Godown in-charge: {assignment.godown?.contactPerson || 'Not recorded'} · {phone(assignment.godown?.contactPhone)}</li>
          <li>Hostel in-charge phone: {phone(assignment.hostel?.hostelPhone)}</li>
        </ul>
        {!assignment.mapping && <p className="mut small">An administrator can import district assignments under Master data. Portal history is not reassigned or rewritten.</p>}
      </section>

      <section className="summary" aria-labelledby="hostel-wa">
        <h2 id="hostel-wa">WhatsApp reminders</h2>
        {assignment.hostel?.whatsappOptOut && <p className="bad-text"><b>This hostel asked us to stop WhatsApp reminders.</b> None will be sent.</p>}
        <WhatsAppHistory messages={whatsapp} />
        {canEdit(viewer) && assignment.hostel && <OptOutForm godownId={assignment.hostel.godownId} hostelCode={code} optedOut={assignment.hostel.whatsappOptOut === true} />}
      </section>

      <section className="summary" aria-labelledby="needs-attention">
        <h2 id="needs-attention">Needs attention now</h2>
        {hostelIssues.filter((i) => ACTIVE.includes(i.state)).length + stuckOrders.length + nCards === 0 && <p className="mut">Nothing is pending for this hostel.</p>}
        {hostelIssues.length > 0 && (
          <>
            <h3 className="sub-h">Issues</h3>
            <ul>{hostelIssues.map((i) => <li key={i.issueId}><Link href={`/issues/${i.issueId}`}>{monthLabel(i.month)}</Link>: {STATE_TEXT[i.state]} · {remarkCounts.get(i.issueId) ?? 0} remark{(remarkCounts.get(i.issueId) ?? 0) === 1 ? '' : 's'}{latestRemark.get(i.issueId) && <span className="mut small"> · last: “{latestRemark.get(i.issueId)}”</span>}</li>)}</ul>
          </>
        )}
        {stuckOrders.length > 0 && (
          <>
            <h3 className="sub-h">Orders waiting a long time</h3>
            <ul>{stuckOrders.map((o) => <li key={o.requestId}><Link href={`/orders/${encodeURIComponent(o.requestId)}`}>{o.requestId}</Link>: {STAGE_LABEL[o.stage]} for <b className={urgency(o, now) === 'late' ? 'bad-text' : ''}>{daysInStage(o, now)} days</b></li>)}</ul>
          </>
        )}
        {nCards > 0 && <p><a href="#looks-wrong">{nCards} unusual request{nCards === 1 ? '' : 's'} to look at ↓</a></p>}
      </section>

      {nCards > 0 && (
        <section aria-labelledby="looks-wrong">
          <h2 className="sub" id="looks-wrong">What looks wrong</h2>
          <div className="hostel solo">
            {duplicates.map((d, i) => <DuplicateCard key={d.key} no={`${i + 1}`} a={d} ctx={ctx} reqs={dupReqs} />)}
            {orders.map((o, i) => <OrderCard key={o.key} no={`${duplicates.length + i + 1}`} a={o} items={orderItems.get(`${o.godownId}|${o.hostelCode}|${o.month}`) ?? []} ctx={ctx} />)}
            {typing.map((t, i) => <TypingCard key={`${t.month}|${t.value}`} no={`${duplicates.length + orders.length + i + 1}`} g={t} ctx={ctx} />)}
            {spikes.map((a, i) => <SpikeCard key={a.key} no={`${duplicates.length + orders.length + typing.length + i + 1}`} a={a} ctx={ctx} />)}
          </div>
        </section>
      )}

      <section aria-labelledby="month-history">
        <h2 className="sub" id="month-history">Indent history by month</h2>
        <form method="get" className="filters" action={`/hostel/${encodeURIComponent(code)}`}>
          {g && <input type="hidden" name="g" value={g} />}
          <label className="select"><span>Month</span>
            <select name="m" defaultValue={selected}>{[...monthList].reverse().map((x) => <option key={x} value={x}>{monthLabel(x)}{requestMonths.includes(x) ? '' : ' (no indent)'}</option>)}</select>
          </label>
          <button className="btn primary-ish" type="submit">Show</button>
        </form>
        {monthReqs.length === 0 ? (
          <p className="empty-note"><b>No indent came for {monthLabel(selected)}.</b> {monthList.indexOf(selected) < monthList.length - 1 ? 'The hostel skipped this month.' : 'It has not arrived yet.'}</p>
        ) : (
          <>
            <ul className="reqlist">
              {monthReqs.map((r) => {
                const o = orderById.get(r.requestId);
                const cells = o ? stageCells(o, now) : null;
                return (
                  <li key={r.requestId} className="req-detail">
                    <div><b>{o ? <Link href={`/orders/${encodeURIComponent(r.requestId)}`}>{r.requestId}</Link> : r.requestId}</b> · placed {r.requestDate.split('-').reverse().join('-')} · <span className={`state ${/^reject/i.test(r.status) ? 'bad' : 'ok'}`}>{r.status.replace(/_/g, ' ')}</span>
                      {o && <> · {OPEN_STAGES.includes(o.stage) ? `${STAGE_LABEL[o.stage]} for ${daysInStage(o, now)} days` : o.stage === 'received' ? <span className="ack-date">Acknowledged {fmtDay(o.stageSince)}</span> : STAGE_LABEL[o.stage]}</>}
                      {o && daysSincePlaced(o, now) !== null && <span className="mut small"> · {daysSincePlaced(o, now)} days since placed</span>}</div>
                    {cells && <ol className="timeline compact">{STAGE_COLUMNS.flatMap((col) => { const x = cells[col.key]; return x ? [<li key={col.key} className={x.current ? 'now' : ''}><b>{col.label}</b> {fmtDay(x.since)}{x.kind === 'counted' ? ` · ${x.days ?? 0} ${x.days === 1 ? 'day' : 'days'}` : x.kind === 'final' ? ' · final' : ''}</li>] : []; })}</ol>}
                  </li>
                );
              })}
            </ul>
            {!monthReqs.every((r) => /^reject/i.test(r.status)) && <p className="lede small">This month against the hostel’s own earlier months{months.filter((x) => x < selected).length ? ` (${months.filter((x) => x < selected).length} earlier month${months.filter((x) => x < selected).length === 1 ? '' : 's'})` : ''}. Quantities are as requested; units come from the item list.</p>}
            {monthReqs.every((r) => /^reject/i.test(r.status)) ? <p className="mut">Every indent for this month was rejected, so its quantities are not counted or compared.</p> : comparison.length === 0 ? <p className="mut">No quantities on record for this month.</p> : (
              <div className="table-wrap"><table className="order-table">
                <thead><tr><th>Item</th><th>Unit</th><th>Pack size</th><th className="num">This month</th><th className="num">Earlier months’ average</th><th>Compared with usual</th></tr></thead>
                <tbody>{comparison.map((r) => {
                  const row = [...unitOf.values()].find((x) => sameItem(x.name, r.item));
                  return <tr key={r.item}><td>{itemLabel(row?.name ?? r.item.split(' [unit:')[0]!)}</td><td>{row?.unit ?? '—'}</td><td>{row?.packSize ?? '—'}</td><td className="num">{num(r.thisMonth)}</td><td className="num">{r.earlierMonths ? num(r.earlierAverage) : '—'}</td><td className={r.ratio !== null && r.ratio >= 2 ? 'late' : ''}>{sizeWords(r.ratio)}</td></tr>;
                })}</tbody>
              </table></div>
            )}
          </>
        )}
      </section>

      <h2 className="sub">Everything this hostel asked for</h2>
      <p className="lede small">Month by month. Numbers in red looked much bigger than usual. Rejected requests are not counted.</p>
      <div className="grid" role="table" aria-label="Quantities requested each month">
        <div className="grid-row head" style={cols} role="row"><span role="columnheader">Item</span>{months.map((m) => <span className="c" role="columnheader" key={m}>{monthLabel(m, true)}</span>)}</div>
        {items.map((it) => (
          <div className="grid-row" style={cols} key={it} role="row">
            <span role="rowheader">{itemLabel(it)}</span>
            {months.map((m) => <span key={m} className="c" role="cell"><span className={hit.has(`${it}|${m}`) ? 'hit' : ''}>{num(h[it]![m] ?? 0)}</span></span>)}
          </div>
        ))}
      </div>

      <h2 className="sub">Each request</h2>
      <ul className="reqlist">
        {[...reqs].sort((a, b) => b.requestDate.localeCompare(a.requestDate)).map((r) => (
          <li key={r.requestId}><span>Placed on {r.requestDate.split('-').reverse().join('-')} for <b>{monthLabel(r.month)}</b></span><span className={`state ${/^reject/i.test(r.status) ? 'bad' : 'ok'}`}>{r.status.replace(/_/g, ' ')}</span></li>
        ))}
      </ul>
    </>
  );
}
