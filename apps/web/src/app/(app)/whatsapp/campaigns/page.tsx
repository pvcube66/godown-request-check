import Link from 'next/link';
import { campaignStats, ensureWhatsAppSettings, isConnected, STATUS_LABEL } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { num, when } from '@/lib/format';
import { masterAdminAccess } from '@/lib/master-auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Campaigns' };

export default async function Campaigns() {
  if (!(await masterAdminAccess()).authorized) return <div className="master-page"><header className="master-header"><h1>Campaigns</h1></header><section className="master-section master-gate"><h2>Administrators only</h2><p>Campaigns are managed by an administrator.</p></section></div>;
  const c = await getDb();
  const s = await ensureWhatsAppSettings(c);
  const list = await c.waCampaigns.find({}).sort({ createdAt: -1 }).limit(100).toArray();
  const stats = await Promise.all(list.map((k) => campaignStats(c, k.campaignId)));
  return (
    <>
      <section className="hero"><h1>Campaigns</h1><p className="lede">Send one approved message to a group of people, a little at a time.</p></section>
      {!isConnected(s) && <p className="alert-bar" role="status">WhatsApp is not connected yet. <Link href="/whatsapp/connect">Connect WhatsApp</Link></p>}
      <div className="toolbar"><span className="toolbar-right"><Link className="btn primary-ish" href="/whatsapp/campaigns/new">New campaign</Link></span></div>
      {list.length === 0 ? <div className="empty">No campaigns yet. Create one to message many people at once.</div> : (
        <div className="table-wrap"><table className="order-table">
          <thead><tr><th>Campaign</th><th>Status</th><th>Progress</th><th className="num">Delivered</th><th className="num">Read</th><th className="num">Failed</th><th>Created</th></tr></thead>
          <tbody>{list.map((k, i) => { const t = stats[i]!, done = t.sent + t.failed + t.previewed; return (
            <tr key={k.campaignId}>
              <td><Link href={`/whatsapp/campaigns/${k.campaignId}`}><b>{k.name}</b></Link><div className="mut small">{k.template.name}</div></td>
              <td><span className={`tpl-status s-${k.status === 'done' ? 'APPROVED' : k.status === 'running' ? 'PENDING' : k.status === 'cancelled' ? 'REJECTED' : 'DRAFT'}`}>{STATUS_LABEL[k.status]}</span>{k.dryRun && <div className="mut small">Preview run</div>}</td>
              <td><div className="bar" role="progressbar" aria-valuenow={done} aria-valuemax={k.total}><span style={{ width: `${k.total ? Math.min(100, Math.round((done / k.total) * 100)) : 0}%` }} /></div><span className="mut small">{num(done)} of {num(k.total)}</span></td>
              <td className="num">{num(t.delivered)}</td><td className="num">{num(t.read)}</td><td className="num">{t.failed ? <span className="bad-text">{num(t.failed)}</span> : 0}</td>
              <td className="mut small">{when(k.createdAt)}</td>
            </tr>); })}</tbody>
        </table></div>
      )}
    </>
  );
}
