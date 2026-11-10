import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { hostelLabel, itemLabel, num } from '@/lib/format';
import { daysSincePlaced, fmtDay, sourceNote, STAGE_COLUMNS, stageCells, urgency } from '@/lib/orders';
import { daysInStage, STAGE_LABEL, itemVariantKey, effectiveItemMetadata } from '@anomaly/core';
import { Icon } from '@/components/Icons';

export const dynamic = 'force-dynamic';

export default async function OrderPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const c = await getDb();
  const now = new Date();
  const o = await c.orders.findOne({ requestId: decodeURIComponent(requestId) });
  if (!o) notFound();
  const request = await c.requests.findOne({ requestId: o.requestId });
  const items = Object.entries(request?.items ?? {}).filter(([, q]) => q > 0);
  const snapshots = request?.itemSnapshots ?? [];
  const masters = snapshots.length ? await c.itemsMaster.find({ key: { $in: snapshots.map(itemVariantKey) } }).toArray() : [];
  const metadataFor = (sourceKey: string) => {
    const snapshot = snapshots.find((s) => s.sourceKey === sourceKey);
    const master = snapshot ? masters.find((m) => m.key === itemVariantKey(snapshot)) : undefined;
    return master ? effectiveItemMetadata(master) : snapshot;
  };
  const cells = stageCells(o, now);
  const steps = STAGE_COLUMNS.flatMap((c) => { const x = cells[c.key]; return x ? [{ key: c.key, label: c.label, ...x }] : []; });
  const u = urgency(o, now);
  const placed = daysSincePlaced(o, now);

  return (
    <>
      <p><Link href="/orders" className="link-arrow"><Icon name="back" size={16} /> Back to orders</Link></p>
      <section className="hero">
        <p className="greet">Order {o.requestId}</p>
        <h1>{hostelLabel(o.hostelName)}</h1>
        <p className="lede">
          Currently: <b>{STAGE_LABEL[o.stage]}</b> for {num(daysInStage(o, now))} {daysInStage(o, now) === 1 ? 'day' : 'days'}
          {u === 'late' && <> · <span className="bad-text">waiting over two weeks</span></>}
          {u === 'watch' && <> · waiting over a week</>}
        </p>
        <p className="status">Hostel ID {o.hostelCode} · {o.districtName} · {o.monthName} {o.academicYear}{placed !== null && <> · placed {fmtDay(o.placedOn)} ({num(placed)} {placed === 1 ? 'day' : 'days'} ago)</>}</p>
      </section>

      <section className="summary" aria-labelledby="timeline">
        <h2 id="timeline">Timeline</h2>
        <ol className="timeline">
          {steps.map((s) => (
            <li key={s.key} className={s.current ? 'now' : ''}>
              <b>{s.label}</b>
              <div>{fmtDay(s.since)} · {s.current ? `${num(s.days)} ${s.days === 1 ? 'day' : 'days'} so far` : `lasted ${num(s.days)} ${s.days === 1 ? 'day' : 'days'}`}</div>
              <div className="mut small">{sourceNote(s.source)}</div>
            </li>
          ))}
        </ol>
        {(o.stage === 'rejected' || o.stage === 'cancelled') && (
          <p className="mut small">We do not know when the order was {o.stage}. The portal keeps no date for it, so the time shown starts from when we first saw it.</p>
        )}
        <p className="mut small">Days are whole calendar days in India time. Dates marked “from the portal” come from the portal's own records.</p>
      </section>

      <section className="summary" aria-labelledby="details">
        <h2 id="details">Delivery details</h2>
        <ul>
          <li>Delivery note (DC) number: <b>{o.dcNumber ?? 'Not made yet'}</b></li>
          <li>Vehicle number: <b>{o.vehicleNo ?? 'Not recorded'}</b></li>
          <li>First seen by us: {fmtDay(o.firstSeenAt)} · last updated: {fmtDay(o.lastSeenAt)}</li>
        </ul>
      </section>

      <section aria-labelledby="items">
        <h2 id="items">Items requested</h2>
        {items.length === 0 ? (
          <p className="mut">The item list for this order is not available yet. It appears after the next full check.</p>
        ) : (
          <div className="table-wrap">
            <table className="order-table">
              <thead><tr><th>Item</th><th>Quantity requested</th><th>Unit</th><th>Pack size</th></tr></thead>
              <tbody>{items.map(([name, q]) => { const metadata = metadataFor(name); return <tr key={name}><td>{itemLabel(name)}</td><td>{num(q)}</td><td>{metadata?.unit || 'Unknown'}</td><td>{metadata?.packSize || 'Unknown'}</td></tr>; })}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
