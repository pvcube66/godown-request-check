import Link from 'next/link';
import { getDb } from '@/lib/db';
import { scopeFor } from '@/lib/viewer';
import { hostelLabel, num } from '@/lib/format';
import { phonesByHostelCode } from '@/lib/history';
import { daysSincePlaced, fmtDay, FLAG_TEXT, hostelIssueTypes, loadOrders, orderMonth, orderMonths, stageCells, STAGE_COLUMNS, stageCounts, STUCK_DAYS, TABS, urgency, type Urgency } from '@/lib/orders';
import { godownLabels } from '@/lib/dashboard';
import { daysInStage, OPEN_STAGES, STAGE_LABEL } from '@anomaly/core';
import { Icon } from '@/components/Icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Orders' };

type SP = { stage?: string; q?: string; month?: string; p?: string; district?: string; account?: string; stuck?: string; ids?: string; hostel?: string };
const PAGE_SIZE = 25;
const URGENCY_TEXT: Record<Urgency, string> = { late: 'Waiting a long time', watch: 'Waiting a while', ok: '' };
const qs = (cur: SP, patch: Partial<SP>) => {
  const p = new URLSearchParams(Object.entries({ ...cur, ...patch }).filter(([, v]) => v) as [string, string][]);
  return `/orders?${p}`;
};
const monthText = (ym: string) => new Date(`${ym}-01T12:00:00+05:30`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

export default async function Orders({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const c = await getDb();
  const { names } = await scopeFor(c);
  const now = new Date();
  const [all, counts, months] = await Promise.all([loadOrders(c, sp, names, 0, now), stageCounts(c, names, { district: sp.district, account: sp.account, q: sp.q, month: sp.month, ids: sp.ids, hostel: sp.hostel }), orderMonths(c, names)]);
  const tab = TABS.find((t) => t.key === sp.stage)?.key ?? 'all';
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const pageNo = Math.min(Math.max(1, Number(sp.p) || 1), pages);
  const offset = (pageNo - 1) * PAGE_SIZE;
  const shown = all.slice(offset, offset + PAGE_SIZE);
  const base = Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== 'p')) as Record<string, string>;
  const late = all.filter((o) => urgency(o, now) === 'late').length;
  const [issueTypes, label, phones] = await Promise.all([hostelIssueTypes(c, names, shown.map((o) => ({ hostelCode: o.hostelCode, month: orderMonth(o.placedOn) }))), godownLabels(c), phonesByHostelCode(c, shown.map((o) => o.hostelCode))]);
  const stuckDays = (STUCK_DAYS as readonly number[]).includes(Number(sp.stuck)) ? Number(sp.stuck) : 0;
  const lastSeen = all.reduce<Date | null>((m, o) => (!m || o.lastSeenAt > m ? o.lastSeenAt : m), null);

  return (
    <div className="orders-page">
      <section className="hero">
        <h1>{num(all.length)} {tab === 'all' ? (all.length === 1 ? 'order' : 'orders') : `${TABS.find((t) => t.key === tab)?.label} ${all.length === 1 ? 'order' : 'orders'}`}</h1>
      </section>

      <div className="order-seg-wrap">
        <nav className="seg order-seg" aria-label="Order stages">
          {TABS.map((t) => {
            const n = (counts as Record<string, number | undefined>)[t.key] ?? 0;
            const on = t.key === tab;
            return (
              <Link key={t.key} href={qs({ ...base, p: '' }, { stage: t.key === 'all' ? '' : t.key })} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
                {t.label}<span className="order-tab-n">{num(n)}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {(sp.district || sp.account || sp.ids || sp.hostel || stuckDays > 0) && (
        <p className="status" role="status">Showing{sp.district && <> district <b>{sp.district}</b></>}{sp.account && <> godown <b>{label(sp.account)}</b></>}{sp.ids && <> the orders counted on the supplier card</>}{sp.hostel && <> hostel <b>{sp.hostel}</b></>}{stuckDays > 0 && <> orders that have been at the same open stage for <b>{stuckDays}+ days</b></>}. <Link href={qs({ stage: sp.stage ?? '', q: sp.q ?? '', month: sp.month ?? '' }, {})} className="link-arrow">Show everything</Link></p>
      )}

      <form className="filters" method="get" action="/orders">
        {sp.stage && <input type="hidden" name="stage" value={sp.stage} />}
        {sp.district && <input type="hidden" name="district" value={sp.district} />}
        {sp.account && <input type="hidden" name="account" value={sp.account} />}
        {sp.stuck && <input type="hidden" name="stuck" value={sp.stuck} />}
        {sp.ids && <input type="hidden" name="ids" value={sp.ids} />}
        {sp.hostel && <input type="hidden" name="hostel" value={sp.hostel} />}
        <label className="select"><span>Placed in</span>
          <select name="month" defaultValue={sp.month ?? ''}>
            <option value="">Any month</option>
            {months.map((m) => <option key={m} value={m}>{monthText(m)}</option>)}
          </select>
        </label>
        <div className="search">
          <label htmlFor="order-q">Find an order or hostel</label>
          <div className="search-row">
            <span className="search-box"><Icon name="search" size={18} /><input id="order-q" name="q" defaultValue={sp.q ?? ''} placeholder="Request number or hostel name" autoComplete="off" /></span>
            <button className="btn primary-ish" type="submit">Search</button>
            {(sp.q || sp.month || sp.district || sp.account || sp.stuck) && <Link href={qs({ stage: sp.stage ?? '' }, {})} className="link-arrow">Clear</Link>}
          </div>
        </div>
        <a className="btn" href={`/orders/csv?${new URLSearchParams(base)}`}><Icon name="download" size={16} /> Download Excel</a>
      </form>

      {all.length === 0 ? (
        <div className="empty">No orders match these choices.</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="order-table order-slim">
              <thead>
                <tr>
                  <th>Request</th><th>Hostel</th><th>Placed</th><th>Now</th>
                  {STAGE_COLUMNS.map((c) => <th key={c.key} className="stage-col" title={`${c.label}: days spent here`}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => {
                  const u = urgency(o, now);
                  const placed = daysSincePlaced(o, now);
                  const cells = stageCells(o, now);
                  const flagTexts = Object.values(FLAG_TEXT);
                  const issue = issueTypes.get(`${o.hostelCode}|${orderMonth(o.placedOn)}`)?.find((t) => !(o.stage === 'rejected' || o.stage === 'cancelled') || !flagTexts.includes(t));     // a rejected order is not checked for unusual quantities
                  return (
                    <tr key={o.requestId}>
                      <td><Link href={`/orders/${encodeURIComponent(o.requestId)}`}>{o.requestId}</Link></td>
                      <td><Link href={`/hostel/${o.hostelCode}`}>{hostelLabel(o.hostelName)}</Link><div className="mut small">{o.districtName}{phones.get(o.hostelCode) && <> · <a href={`tel:${phones.get(o.hostelCode)!.replace(/[^+0-9]/g, '')}`}>{phones.get(o.hostelCode)}</a></>}{issue && <span className="flag-note"> · {issue}</span>}</div></td>
                      <td>{fmtDay(o.placedOn)}{placed !== null && <div className="mut small">{num(placed)}d ago</div>}</td>
                      <td><span className={`stage-chip st-${o.stage}`}>{STAGE_LABEL[o.stage]}</span>{OPEN_STAGES.includes(o.stage)
                        ? <div className={`small now-days ${u}`}>{num(daysInStage(o, now))} {daysInStage(o, now) === 1 ? 'day' : 'days'}</div>
                        : o.stage === 'received' ? <div className="small ack-date">{fmtDay(o.stageSince)}</div> : null}</td>
                      {STAGE_COLUMNS.map((c) => {
                        const cell = cells[c.key];
                        if (!cell) return <td key={c.key} className="stage-col none">·</td>;
                        const hot = cell.current ? u : 'ok';
                        const when = `${c.label}: ${fmtDay(cell.since)}${cell.source === 'observed' ? ' (first seen by us)' : ''}`;
                        return (
                          <td key={c.key} title={when} className={`stage-col ${cell.kind} ${cell.current ? 'current' : ''} ${hot === 'ok' ? '' : hot}`}>
                            {cell.kind === 'counted' && <b>{num(cell.days ?? 0)}d</b>}
                            {cell.kind === 'ack' && <b className="ack-date">{fmtDay(cell.since).replace(/\s\d{4}$/, '')}</b>}
                            {cell.kind === 'final' && <b>{fmtDay(cell.since).replace(/\s\d{4}$/, '')}</b>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <nav className="pager-bar" aria-label="Pages of orders">
            <span className="mut">Showing {num(offset + 1)} to {num(Math.min(offset + PAGE_SIZE, all.length))} of {num(all.length)}</span>
            <div className="pager-ctrl">
              {pageNo > 1
                ? <Link className="pager-btn" href={qs(base, { p: String(pageNo - 1) })} rel="prev"><Icon name="chevronLeft" size={16} /> Previous</Link>
                : <span className="pager-btn off" aria-disabled="true"><Icon name="chevronLeft" size={16} /> Previous</span>}
              <span className="pager-page">Page {pageNo} of {pages}</span>
              {pageNo < pages
                ? <Link className="pager-btn" href={qs(base, { p: String(pageNo + 1) })} rel="next">Next <Icon name="chevronRight" size={16} /></Link>
                : <span className="pager-btn off" aria-disabled="true">Next <Icon name="chevronRight" size={16} /></span>}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
