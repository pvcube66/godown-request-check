import Link from 'next/link';
import { notFound } from 'next/navigation';
import { normalizedItemName, scoped, STAGE_LABEL } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { scopeFor } from '@/lib/viewer';
import { hostelLabel, itemLabel, monthLabel, num } from '@/lib/format';
import { loadIndent } from '@/lib/indent';
import { loadHostelPhones } from '@/lib/history';
import { loadItemNames } from '@/lib/item-names';
import { openFlagFilter } from '@/lib/orders';
import { orderMonth } from '@/lib/orders';
import { Icon } from '@/components/Icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Indent' };

export default async function IndentView({ params }: { params: Promise<{ requestId: string }> }) {
  const id = decodeURIComponent((await params).requestId);
  const c = await getDb();
  const { names } = await scopeFor(c);
  const order = await c.orders.findOne(scoped({ requestId: id }, names));
  if (!order) notFound();
  const month = orderMonth(order.placedOn);
  const request = await c.requests.findOne({ requestId: id }, { projection: { itemSnapshots: 1, godownId: 1 } });
  const [rows, itemNames, flags, phones] = await Promise.all([
    loadIndent(c, id),
    loadItemNames(c),
    c.anomalies.find(scoped(openFlagFilter(order.hostelCode, month), names), { projection: { item: 1, kind: 1, severity: 1, requested: 1, expected: 1 } }).toArray(),
    loadHostelPhones(c, request ? [{ godownId: request.godownId, hostelCode: order.hostelCode }] : []),
  ]);
  const supplied = new Map((request?.itemSnapshots ?? []).map((s) => [s.sourceKey, s.suppliedQuantity]));
  const flaggedItems = new Set(flags.filter((f) => f.kind === 'spike' || f.kind === 'typing').map((f) => normalizedItemName(f.item.split(' [unit:')[0]!)));
  const phone = request ? phones.get(`${request.godownId}|${order.hostelCode}`) : undefined;
  const hasSupplied = rows.some((r) => supplied.get(r.name) !== undefined);

  return (
    <>
      <p><Link href="/indents" className="link-arrow"><Icon name="back" size={16} /> Back to indents</Link></p>
      <section className="hero">
        <p className="greet">Indent {order.requestId}</p>
        <h1>{hostelLabel(order.hostelName)}</h1>
        <p className="lede">{order.districtName} · Hostel ID {order.hostelCode} · {month ? monthLabel(month) : ''} · {STAGE_LABEL[order.stage]}{phone && <> · Hostel phone <a href={`tel:${phone.replace(/[^+0-9]/g, '')}`}>{phone}</a></>}</p>
        <p className="lede small"><Link href={`/orders/${encodeURIComponent(order.requestId)}`} className="link-arrow">Order tracking<Icon name="arrow" size={14} /></Link> <Link href={`/hostel/${encodeURIComponent(order.hostelCode)}`} className="link-arrow">Hostel page<Icon name="arrow" size={14} /></Link></p>
      </section>
      {flags.length > 0 && <p className="alert-bar" role="status">{flags.length} unusual request{flags.length === 1 ? '' : 's'} for this hostel in {monthLabel(month)}. The items are highlighted below.</p>}
      {rows.length === 0 ? <div className="empty">The portal returned no items for this indent.</div> : (
        <div className="table-wrap"><table className="order-table">
          <thead><tr><th>Item</th><th className="num">Asked for</th><th>Pack size</th>{hasSupplied && <th className="num">Supplied</th>}<th /></tr></thead>
          <tbody>{rows.map((r) => {
            const hot = flaggedItems.has(normalizedItemName(r.name)), s = supplied.get(r.name);
            return (
              <tr key={r.name} className={hot ? 'flagged-row' : ''}>
                <td><b>{itemLabel(r.name, itemNames)}</b></td>
                <td className="num">{num(r.quantity)} {r.unit}</td><td>{r.packSize}</td>
                {hasSupplied && <td className="num">{s === undefined ? '—' : num(s)}</td>}
                <td>{hot && <span className="tag-flag">Unusual</span>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <p className="mut small">{num(rows.length)} item{rows.length === 1 ? '' : 's'} asked for. Supplied quantities show only once the portal has them.</p>
    </>
  );
}
