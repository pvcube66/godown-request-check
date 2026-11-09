import Link from 'next/link';
import { getDb } from '@/lib/db';
import { hostelLabel, itemLabel, monthLabel, num } from '@/lib/format';
import { groupFlags } from '@/lib/group';
import { hostelKey, loadHistory, loadOrderItems, monthsWithRequests } from '@/lib/history';
import { OrderCard, SpikeCard, TypingCard } from '@/components/FlagCards';
import { Icon } from '@/components/Icons';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const c = await getDb(); const { code } = await params;
  const r = await c.requests.findOne({ hostelCode: code }, { projection: { hostelName: 1 } });
  return { title: r ? hostelLabel(r.hostelName) : 'Hostel' };
}

export default async function Hostel({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ g?: string }> }) {
  const { code } = await params;
  const { g } = await searchParams;
  const c = await getDb();
  const filter = { hostelCode: code, ...(g ? { godownId: Number(g) } : {}) };
  const reqs = await c.requests.find(filter).toArray();
  if (!reqs.length) return (
    <div className="empty"><h2>Hostel not found</h2><p>We could not find any requests for this hostel.</p><Link className="btn" href="/">Back to the list</Link></div>
  );
  const godownId = reqs[0]!.godownId;
  const size = await c.hostels.findOne({ godownId, hostelCode: code });
  const flagged = await c.anomalies.find({ ...filter, status: 'open' }).sort({ ratio: -1 }).toArray();
  const { history, months: allMonths } = await loadHistory(c, [{ godownId, hostelCode: code }]);
  const h = history[hostelKey(godownId, code)] ?? {};
  const months = [...monthsWithRequests(h)].sort();
  const { orders, typing, spikes: spikesAll } = groupFlags(flagged);
  const spikes = spikesAll.filter((a) => !a.partOfOrder);
  const orderItems = await loadOrderItems(c, orders);
  const ctx = { history, months: allMonths, view: 'open' as const };

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
  const nCards = orders.length + typing.length + spikes.length;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/"><Icon name="back" size={16} />Unusual requests</Link></nav>
      <section className="hero">
        <h1>{hostelLabel(reqs[0]!.hostelName)}</h1>
        <p className="where big"><Icon name="pin" size={17} />{reqs[0]!.districtName} district</p>
        <ul className="facts">
          <li>{size?.students ? <><b>{size.students.toLocaleString('en-IN')}</b> students</> : <span className="mut">Student count not available</span>}</li>
          <li><b>{reqs.length}</b> request{reqs.length > 1 ? 's' : ''} on record</li>
          <li><b>{months.length}</b> month{months.length > 1 ? 's' : ''} of history</li>
          <li className={nCards ? 'warn' : 'good'}><b>{nCards}</b> to look at</li>
        </ul>
      </section>

      {nCards > 0 && (
        <section aria-labelledby="looks-wrong">
          <h2 className="sub" id="looks-wrong">What looks wrong</h2>
          <div className="hostel solo">
            {orders.map((o) => <OrderCard key={o.key} a={o} items={orderItems.get(`${o.godownId}|${o.hostelCode}|${o.month}`) ?? []} ctx={ctx} />)}
            {typing.map((t) => <TypingCard key={`${t.month}|${t.value}`} g={t} ctx={ctx} />)}
            {spikes.map((a) => <SpikeCard key={a.key} a={a} ctx={ctx} />)}
          </div>
        </section>
      )}

      <h2 className="sub">Everything this hostel asked for</h2>
      <p className="lede small">Month by month. Numbers shaded red looked much bigger than usual. Rejected requests are not counted.</p>
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
