import Link from 'next/link';
import { rate, waStats } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { num } from '@/lib/format';
import { masterAdminAccess } from '@/lib/master-auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'WhatsApp stats' };
const RANGES = [7, 14, 30, 90] as const;

const dayLabel = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export default async function Stats({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  if (!(await masterAdminAccess()).authorized) return <div className="master-page"><header className="master-header"><h1>WhatsApp stats</h1></header><section className="master-section master-gate"><h2>Administrators only</h2><p>Stats are shown to an administrator.</p></section></div>;
  const sp = await searchParams;
  const days = (RANGES as readonly number[]).includes(Number(sp.d)) ? Number(sp.d) : 14;
  const st = await waStats(await getDb(), days);
  const peak = Math.max(1, ...st.byDay.map((r) => r.sent));
  return (
    <>
      <section className="hero"><h1>WhatsApp stats</h1><p className="lede">How your messages did in the last {days} days.</p></section>
      <nav className="type-chips" aria-label="Time range">{RANGES.map((r) => <Link key={r} className={`type-chip ${r === days ? 'on' : ''}`} href={`/whatsapp/stats?d=${r}`}>{r} days</Link>)}</nav>
      <div className="tile-row">
        <div className="stat-tile"><b>{num(st.sent)}</b><span>Messages sent</span></div>
        <div className="stat-tile"><b>{rate(st.delivered, st.sent)}%</b><span>Delivered ({num(st.delivered)})</span></div>
        <div className="stat-tile"><b>{rate(st.read, st.sent)}%</b><span>Read ({num(st.read)})</span></div>
        <div className={`stat-tile ${st.failed ? 'bad' : ''}`}><b>{num(st.failed)}</b><span>Not delivered</span></div>
        <div className="stat-tile"><b>{num(st.replies)}</b><span>Replies received</span></div>
      </div>

      {st.sent === 0 ? <div className="empty">No messages in this period yet.</div> : (
        <>
          <h2 className="sec-title">By day</h2>
          <div className="table-wrap"><table className="order-table"><thead><tr><th>Day</th><th>Sent</th><th className="num">Delivered</th><th className="num">Read</th><th className="num">Not delivered</th></tr></thead>
            <tbody>{st.byDay.map((r) => <tr key={r.day}><td>{dayLabel(r.day)}</td><td><div className="bar" aria-hidden="true"><span style={{ width: `${Math.round((r.sent / peak) * 100)}%` }} /></div><span className="small">{num(r.sent)}</span></td><td className="num">{rate(r.delivered, r.sent)}%</td><td className="num">{rate(r.read, r.sent)}%</td><td className="num">{r.failed ? <span className="bad-text">{num(r.failed)}</span> : 0}</td></tr>)}</tbody></table></div>

          <h2 className="sec-title">By template</h2>
          <div className="table-wrap"><table className="order-table"><thead><tr><th>Template</th><th className="num">Sent</th><th className="num">Delivered</th><th className="num">Read</th><th className="num">Not delivered</th></tr></thead>
            <tbody>{st.byTemplate.map((r) => <tr key={r.template}><td><b>{r.template}</b></td><td className="num">{num(r.sent)}</td><td className="num">{rate(r.delivered, r.sent)}%</td><td className="num">{rate(r.read, r.sent)}%</td><td className="num">{r.failed ? <span className="bad-text">{num(r.failed)}</span> : 0}</td></tr>)}</tbody></table></div>
        </>
      )}

      {st.failures.length > 0 && (
        <>
          <h2 className="sec-title">Why messages were not delivered</h2>
          <div className="table-wrap"><table className="order-table"><thead><tr><th>Reason</th><th>What to do</th><th className="num">Messages</th></tr></thead>
            <tbody>{st.failures.map((f) => <tr key={f.title}><td><b>{f.title}</b></td><td className="small">{f.action}</td><td className="num">{num(f.n)}</td></tr>)}</tbody></table></div>
        </>
      )}
    </>
  );
}
