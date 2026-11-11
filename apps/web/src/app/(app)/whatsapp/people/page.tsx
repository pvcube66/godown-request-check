import Link from 'next/link';
import { contactFilter, maskPhone, tagCounts } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { num } from '@/lib/format';
import { masterAdminAccess } from '@/lib/master-auth';
import { Icon } from '@/components/Icons';
import { ContactsTable, GroupRow, NewGroup } from './PeopleClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'People' };
const PAGE = 25;

export default async function People({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; tag?: string; group?: string; p?: string }> }) {
  if (!(await masterAdminAccess()).authorized) return <div className="master-page"><header className="master-header"><h1>People</h1></header><section className="master-section master-gate"><h2>Administrators only</h2><p>Contacts are managed by an administrator.</p></section></div>;
  const sp = await searchParams;
  const tab = sp.tab === 'groups' ? 'groups' : 'contacts';
  const q = (sp.q ?? '').trim().slice(0, 60), tag = (sp.tag ?? '').slice(0, 30), groupName = (sp.group ?? '').slice(0, 100);
  const c = await getDb();
  const groups = await c.waGroups.find({}).sort({ name: 1 }).toArray();
  const total = await c.waContacts.countDocuments();
  const href = (o: Record<string, string>) => `/whatsapp/people?${new URLSearchParams(Object.entries({ tab, q, tag, group: groupName, ...o }).filter(([, v]) => v) as [string, string][])}`;

  let body;
  if (tab === 'groups') {
    const everyone = new Map<string, string>();
    const phones = [...new Set(groups.flatMap((g) => g.members))];
    for (const p of await c.waContacts.find({ phone: { $in: phones } }, { projection: { phone: 1, name: 1 } }).toArray()) everyone.set(p.phone, p.name);
    body = (
      <>
        <div className="toolbar"><NewGroup /></div>
        {groups.length === 0 ? <div className="empty">No groups yet. A group is a named list of people you can message together.</div> : (
          <div className="table-wrap"><table className="order-table"><thead><tr><th>Group</th><th className="num">Members</th><th /></tr></thead>
            <tbody>{groups.map((g) => <GroupRow key={g.name} name={g.name} members={g.members.map((p) => ({ phone: p, name: everyone.get(p) ?? '' }))} />)}</tbody></table></div>
        )}
      </>
    );
  } else {
    const members = groupName ? groups.find((g) => g.name === groupName)?.members ?? [] : undefined;
    const filter = contactFilter({ q, tag }, members);
    const [count, list, tags] = await Promise.all([c.waContacts.countDocuments(filter), c.waContacts.find(filter).sort({ createdAt: -1, phone: 1 }).skip((Math.max(1, Number(sp.p) || 1) - 1) * PAGE).limit(PAGE).toArray(), tagCounts(c)]);
    const pages = Math.max(1, Math.ceil(count / PAGE)), page = Math.min(pages, Math.max(1, Number(sp.p) || 1));
    body = (
      <>
        <div className="toolbar">
          <form method="get" action="/whatsapp/people" className="toolbar-search">
            {tag && <input type="hidden" name="tag" value={tag} />}{groupName && <input type="hidden" name="group" value={groupName} />}
            <span className="search-box"><Icon name="search" size={18} /><input name="q" defaultValue={q} placeholder="Search name, number, email" autoComplete="off" /></span>
            <button className="btn" type="submit">Search</button>
          </form>
          <span className="toolbar-right"><a className="btn" href={`/whatsapp/people/export?${new URLSearchParams({ q, tag })}`}><Icon name="download" size={16} /> Export</a></span>
        </div>
        {(tags.length > 0 || groups.length > 0) && (
          <nav className="type-chips" aria-label="Filter">
            <Link className={`type-chip ${!tag && !groupName ? 'on' : ''}`} href={href({ tag: '', group: '', p: '' })}>Everyone<span className="type-n">{num(total)}</span></Link>
            {tags.slice(0, 12).map((t) => <Link key={t.tag} className={`type-chip ${tag === t.tag ? 'on' : ''}`} href={href({ tag: t.tag, group: '', p: '' })}>{t.tag}<span className="type-n">{t.n}</span></Link>)}
            {groups.map((g) => <Link key={g.name} className={`type-chip ${groupName === g.name ? 'on' : ''}`} href={href({ group: g.name, tag: '', p: '' })}>Group: {g.name}<span className="type-n">{g.members.length}</span></Link>)}
          </nav>
        )}
        <ContactsTable groups={groups.map((g) => g.name)} rows={list.map((p) => ({ phone: p.phone, masked: maskPhone(p.phone), name: p.name, email: p.email, tags: p.tags, notes: p.notes, source: p.source, optedOut: p.optedOut }))} />
        {pages > 1 && (
          <nav className="pager-bar" aria-label="Pages"><span className="mut">Showing {(page - 1) * PAGE + 1} to {Math.min(page * PAGE, count)} of {num(count)}</span>
            <div className="pager-ctrl">
              {page > 1 ? <Link className="pager-btn" href={href({ p: String(page - 1) })}><Icon name="chevronLeft" size={16} /> Previous</Link> : <span className="pager-btn off"><Icon name="chevronLeft" size={16} /> Previous</span>}
              <span className="pager-page">Page {page} of {pages}</span>
              {page < pages ? <Link className="pager-btn" href={href({ p: String(page + 1) })}>Next <Icon name="chevronRight" size={16} /></Link> : <span className="pager-btn off">Next <Icon name="chevronRight" size={16} /></span>}
            </div></nav>
        )}
      </>
    );
  }

  return (
    <>
      <section className="hero"><h1>People</h1></section>
      <nav className="seg order-seg" aria-label="People">
        <Link href="/whatsapp/people" className={tab === 'contacts' ? 'on' : ''}>Contacts<span className="order-tab-n">{num(total)}</span></Link>
        <Link href="/whatsapp/people?tab=groups" className={tab === 'groups' ? 'on' : ''}>Groups<span className="order-tab-n">{groups.length}</span></Link>
      </nav>
      {body}
    </>
  );
}
