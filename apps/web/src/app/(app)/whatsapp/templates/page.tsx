import Link from 'next/link';
import { STATUS_TEXT, isConnected, ensureWhatsAppSettings } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { when } from '@/lib/format';
import { masterAdminAccess } from '@/lib/master-auth';
import { Icon } from '@/components/Icons';
import WaPreview from '@/components/WaPreview';
import { RowActions, SyncButton } from './RowActions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Message templates' };

const FILTERS = [['', 'All'], ['APPROVED', 'Approved'], ['PENDING', 'Waiting'], ['REJECTED', 'Rejected'], ['DRAFT', 'Drafts']] as const;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default async function Templates({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  if (!(await masterAdminAccess()).authorized) return <div className="master-page"><header className="master-header"><h1>Message templates</h1></header><section className="master-section master-gate"><h2>Administrators only</h2><p>Templates are managed by an administrator.</p></section></div>;
  const sp = await searchParams;
  const status = FILTERS.some(([k]) => k === sp.status && k) ? sp.status! : '';
  const q = (sp.q ?? '').trim().slice(0, 60);
  const c = await getDb();
  const s = await ensureWhatsAppSettings(c);
  const filter = { ...(status ? { status } : {}), ...(q ? { name: { $regex: escapeRe(q), $options: 'i' } } : {}) };
  const [list, counts] = await Promise.all([
    c.waTemplates.find(filter).sort({ updatedAt: -1 }).limit(200).toArray(),
    c.waTemplates.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
  ]);
  const n = (k: string) => (k ? counts.find((x) => x._id === k)?.n ?? 0 : counts.reduce((t, x) => t + x.n, 0));
  const href = (o: Record<string, string>) => `/whatsapp/templates?${new URLSearchParams(Object.entries({ q, status, ...o }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <section className="hero"><h1>Message templates</h1><p className="lede">Messages WhatsApp has approved, ready to send.</p></section>
      {!isConnected(s) && <p className="alert-bar" role="status">WhatsApp is not connected yet. You can write drafts, but sending and syncing need a connection. <Link href="/whatsapp/connect">Connect WhatsApp</Link></p>}
      <div className="toolbar">
        <form method="get" action="/whatsapp/templates" className="toolbar-search">
          {status && <input type="hidden" name="status" value={status} />}
          <span className="search-box"><Icon name="search" size={18} /><input name="q" defaultValue={q} placeholder="Search templates" autoComplete="off" /></span>
          <button className="btn" type="submit">Search</button>
        </form>
        <span className="toolbar-right"><SyncButton /><Link className="btn primary-ish" href="/whatsapp/templates/new">Create template</Link></span>
      </div>
      <nav className="seg order-seg" aria-label="Status">
        {FILTERS.map(([k, l]) => <Link key={k || 'all'} href={href({ status: k })} className={k === status ? 'on' : ''}>{l}<span className="order-tab-n">{n(k)}</span></Link>)}
      </nav>
      {list.length === 0 ? <div className="empty">{q || status ? 'No templates match.' : 'No templates yet. Create one, or sync to bring in the ones already on WhatsApp.'}</div> : (
        <div className="table-wrap"><table className="order-table">
          <thead><tr><th>Name</th><th>Category</th><th>Language</th><th>Status</th><th>Updated</th><th /></tr></thead>
          <tbody>{list.map((t) => (
            <tr key={`${t.name}|${t.language}`}>
              <td><details className="tpl"><summary><b>{t.name}</b></summary><WaPreview header={t.form?.headerText} body={t.bodyText} examples={t.form?.examples ?? []} footer={t.form?.footer} buttons={t.form?.buttons} headerExample={t.form?.headerExample} /></details></td>
              <td>{t.category === 'MARKETING' ? 'Marketing' : t.category === 'UTILITY' ? 'Utility' : t.category}</td><td>{t.language}</td>
              <td><span className={`tpl-status s-${t.status}`}>{STATUS_TEXT[t.status] ?? t.status}</span>{t.reason && <div className="small bad-text">{t.reason.replace(/_/g, ' ').toLowerCase()}</div>}</td>
              <td className="mut small">{when(t.updatedAt)}</td>
              <td className="num"><RowActions name={t.name} language={t.language} isDraft={t.status === 'DRAFT'} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
