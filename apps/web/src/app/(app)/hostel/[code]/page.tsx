import Link from 'next/link';
import { canEdit, istDay, resolveHostelMapping, scoped } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { getViewer, scopeFor, visibleDistricts } from '@/lib/viewer';
import { hostelLabel, itemLabel, monthLabel, num } from '@/lib/format';
import { groupFlags } from '@/lib/group';
import { hostelKey, loadHistory, loadOrderItems, loadRequestsById, monthsWithRequests } from '@/lib/history';
import { DuplicateCard, OrderCard, SpikeCard, TypingCard } from '@/components/FlagCards';
import { Icon } from '@/components/Icons';
import { STATE_TEXT } from '@anomaly/core';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const c = await getDb(); const { code } = await params;
  const v = await getViewer();
  if (!v) return { title: 'Hostel' };
  const r = await c.requests.findOne(scoped({ hostelCode: code }, await visibleDistricts(c, v)), { projection: { hostelName: 1 } });
  return { title: r ? hostelLabel(r.hostelName) : 'Hostel' };
}

export default async function Hostel({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ g?: string }> }) {
  const { code } = await params;
  const { g } = await searchParams;
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
  const { orders, duplicates, typing, spikes: spikesAll } = groupFlags(flagged);
  const spikes = spikesAll.filter((a) => !a.partOfOrder);
  const orderItems = await loadOrderItems(c, orders);
  const dupReqs = await loadRequestsById(c, duplicates.flatMap((a) => a.dup!.requestIds));
  const ctx = { history, months: allMonths, view: 'open' as const, showActions: canEdit(viewer) };
  const hostelIssues = await c.issues.find(scoped({ godownId, hostelCode: code }, names)).sort({ raisedAt: -1 }).limit(20).toArray();
  const remarkCounts = hostelIssues.length ? new Map((await c.remarks.aggregate<{ _id: string; n: number }>([{ $match: { targetType: 'issue', targetId: { $in: hostelIssues.map((i) => i.issueId) } } }, { $group: { _id: '$targetId', n: { $sum: 1 } } }]).toArray()).map((r) => [r._id, r.n])) : new Map<string, number>();

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

      {hostelIssues.length > 0 && (
        <section className="summary" aria-labelledby="hostel-issues">
          <h2 id="hostel-issues">Issues for this hostel</h2>
          <ul>{hostelIssues.map((i) => <li key={i.issueId}><Link href={`/issues/${i.issueId}`}>{monthLabel(i.month)}</Link>: {STATE_TEXT[i.state]} · {remarkCounts.get(i.issueId) ?? 0} remark{(remarkCounts.get(i.issueId) ?? 0) === 1 ? '' : 's'}</li>)}</ul>
        </section>
      )}

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

      <h2 className="sub">Everything this hostel asked for</h2>
      <p className="lede small">Month by month. Numbers highlighted in black looked much bigger than usual. Rejected requests are not counted.</p>
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
