import Link from 'next/link';
import { notFound } from 'next/navigation';
import { campaignStats, STATUS_LABEL } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { num, when } from '@/lib/format';
import { masterAdminAccess } from '@/lib/master-auth';
import CampaignControls from './CampaignControls';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Campaign' };
const PAGE = 50;
const WHO = { queued: 'Waiting', sent: 'Sent', failed: 'Not sent', previewed: 'Preview only', cancelled: 'Skipped' } as const;

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ p?: string; s?: string }> }) {
  if (!(await masterAdminAccess()).authorized) return <div className="master-page"><header className="master-header"><h1>Campaign</h1></header><section className="master-section master-gate"><h2>Administrators only</h2><p>Campaigns are managed by an administrator.</p></section></div>;
  const { id } = await params; const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const c = await getDb();
  const k = await c.waCampaigns.findOne({ campaignId: id });
  if (!k) notFound();
  const filter = ['queued', 'sent', 'failed', 'previewed', 'cancelled'].includes(sp.s ?? '') ? { campaignId: id, status: sp.s as 'sent' } : { campaignId: id };
  const [t, count] = await Promise.all([campaignStats(c, id), c.waCampaignRecipients.countDocuments(filter)]);
  const pages = Math.max(1, Math.ceil(count / PAGE)), page = Math.min(pages, Math.max(1, Number(sp.p) || 1));
  const rows = await c.waCampaignRecipients.find(filter).sort({ _id: 1 }).skip((page - 1) * PAGE).limit(PAGE).toArray();
  const msgs = new Map((await c.whatsappMessages.find({ campaignId: id, phone: { $in: rows.map((r) => r.phone) } }, { projection: { phone: 1, status: 1 } }).toArray()).map((m) => [m.phone, m.status]));
  const href = (o: Record<string, string>) => `/whatsapp/campaigns/${id}?${new URLSearchParams(Object.entries({ s: sp.s ?? '', ...o }).filter(([, v]) => v) as [string, string][])}`;
  const tiles: [string, number, string?][] = [['People', k.total], ['Waiting', t.queued], [k.dryRun ? 'Previewed' : 'Sent', k.dryRun ? t.previewed : t.sent], ['Delivered', t.delivered], ['Read', t.read], ['Not sent', t.failed, t.failed ? 'bad' : '']];
  return (
    <>
      <section className="hero"><h1>{k.name}</h1><p className="lede">{k.template.name} · {STATUS_LABEL[k.status]}{k.dryRun ? ' (preview run: nothing was sent)' : ''} · created {when(k.createdAt)}</p></section>
      <p><Link href="/whatsapp/campaigns">← All campaigns</Link></p>
      {k.lastError && k.status === 'paused' && <p className="alert-bar" role="alert">Paused: {k.lastError}</p>}
      {k.skippedOptOut > 0 && <p className="mut small">{k.skippedOptOut} {k.skippedOptOut === 1 ? 'person was' : 'people were'} left out because they opted out.</p>}
      <CampaignControls id={id} status={k.status} failed={t.failed} />
      <div className="tile-row">{tiles.map(([l, n, tone]) => <div key={l} className={`stat-tile ${tone ?? ''}`}><b>{num(n)}</b><span>{l}</span></div>)}</div>
      <nav className="type-chips" aria-label="Filter people">
        {([['', 'Everyone'], ['sent', 'Sent'], ['failed', 'Not sent'], ['queued', 'Waiting'], ['cancelled', 'Skipped']] as const).map(([v, l]) => <Link key={v} className={`type-chip ${(sp.s ?? '') === v ? 'on' : ''}`} href={href({ s: v, p: '' })}>{l}</Link>)}
      </nav>
      <div className="table-wrap"><table className="order-table">
        <thead><tr><th>Person</th><th>Result</th><th>Delivery</th><th>Note</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.phone}><td><b>{r.name || 'No name'}</b><div className="mut small">+{r.phone}</div></td><td>{WHO[r.status]}</td><td className="mut small">{msgs.get(r.phone) === 'read' ? 'Read' : msgs.get(r.phone) === 'delivered' ? 'Delivered' : msgs.get(r.phone) === 'failed' ? 'Failed' : ''}</td><td className="small">{r.error}</td></tr>)}
          {rows.length === 0 && <tr><td colSpan={4} className="mut">No one here.</td></tr>}</tbody>
      </table></div>
      {pages > 1 && <nav className="pager-bar" aria-label="Pages"><span className="mut">Page {page} of {pages}</span><div className="pager-ctrl">{page > 1 && <Link className="pager-btn" href={href({ p: String(page - 1) })}>Previous</Link>}{page < pages && <Link className="pager-btn" href={href({ p: String(page + 1) })}>Next</Link>}</div></nav>}
    </>
  );
}
