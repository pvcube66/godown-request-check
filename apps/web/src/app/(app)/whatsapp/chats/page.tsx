import Link from 'next/link';
import { CHAT_FILTERS, conversationFilter, failureText, isConnected, ensureWhatsAppSettings, windowEndsAt } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { masterAdminAccess } from '@/lib/master-auth';
import { Icon } from '@/components/Icons';
import ChatThread, { type Msg } from './ChatThread';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Chats' };
const STEP = 30;

const shortTime = (d: Date) => d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

export default async function Chats({ searchParams }: { searchParams: Promise<{ c?: string; q?: string; f?: string; n?: string }> }) {
  if (!(await masterAdminAccess()).authorized) return <div className="master-page"><header className="master-header"><h1>Chats</h1></header><section className="master-section master-gate"><h2>Administrators only</h2><p>Chats are managed by an administrator.</p></section></div>;
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 60), f = CHAT_FILTERS.some(([k]) => k === sp.f) ? sp.f! : 'all';
  const limit = Math.min(300, Math.max(STEP, Number(sp.n) || STEP));
  const open = /^\d{8,15}$/.test(sp.c ?? '') ? sp.c! : '';
  const c = await getDb();
  const s = await ensureWhatsAppSettings(c);
  const [list, unreadTotal] = await Promise.all([c.waConversations.find(conversationFilter({ q, filter: f })).sort({ lastAt: -1 }).limit(limit + 1).toArray(), c.waConversations.countDocuments({ unread: { $gt: 0 } })]);
  const more = list.length > limit; if (more) list.pop();
  const href = (o: Record<string, string>) => `/whatsapp/chats?${new URLSearchParams(Object.entries({ q, f: f === 'all' ? '' : f, c: open, ...o }).filter(([, v]) => v) as [string, string][])}`;

  let thread: React.ReactNode = <div className="empty chat-empty">Choose a chat on the left.</div>;
  if (open) {
    const [conv, contact, msgs, templates, quick] = await Promise.all([
      c.waConversations.findOne({ phone: open }), c.waContacts.findOne({ phone: open }),
      c.whatsappMessages.find({ phone: open }).sort({ createdAt: -1 }).limit(200).toArray(),
      c.waTemplates.find({ status: 'APPROVED' }).sort({ name: 1 }).limit(100).toArray(),
      c.waQuickReplies.find({}).sort({ title: 1 }).limit(50).toArray(),
    ]);
    const ends = windowEndsAt(conv?.lastInboundAt ?? null);
    const rows: Msg[] = msgs.reverse().map((m, i) => ({ id: String(m.messageId ?? `${m.createdAt.getTime()}-${i}`), out: m.direction === 'out', text: m.text, status: m.status, at: m.createdAt.toISOString(), time: shortTime(m.createdAt), note: m.status === 'failed' ? failureText(m)?.title ?? 'Not sent' : '', by: m.kind === 'reminder' ? 'Reminder' : m.kind === 'campaign' ? 'Campaign' : '' }));
    thread = <ChatThread phone={open} name={conv?.contactName || contact?.name || ''} status={conv?.status ?? 'open'} unread={conv?.unread ?? 0} optedOut={!!contact?.optedOut} windowEnds={ends && ends.getTime() > Date.now() ? ends.toISOString() : null} live={s.mode === 'live'} msgs={rows} quick={quick.map((q) => ({ title: q.title, text: q.text }))}
      templates={templates.map((t) => ({ name: t.name, language: t.language, body: t.bodyText, hasHeaderVar: /\{\{\d+\}\}/.test(t.form?.headerText ?? '') }))} />;
  }

  return (
    <>
      <section className="hero"><h1>Chats</h1></section>
      {!isConnected(s) && <p className="alert-bar" role="status">WhatsApp is not connected yet, so there are no chats. <Link href="/whatsapp/connect">Connect WhatsApp</Link></p>}
      <div className="chat-grid">
        <aside className="chat-list" aria-label="Chats">
          <form method="get" action="/whatsapp/chats" className="toolbar-search">
            {f !== 'all' && <input type="hidden" name="f" value={f} />}
            <span className="search-box"><Icon name="search" size={18} /><input name="q" defaultValue={q} placeholder="Search name, number, message" autoComplete="off" /></span>
          </form>
          <nav className="type-chips" aria-label="Filter chats">{CHAT_FILTERS.map(([k, l]) => <Link key={k} className={`type-chip ${k === f ? 'on' : ''}`} href={href({ f: k === 'all' ? '' : k, c: '' })}>{l}{k === 'unread' && unreadTotal > 0 && <span className="type-n">{unreadTotal}</span>}</Link>)}</nav>
          {list.length === 0 ? <div className="empty">{q || f !== 'all' ? 'No chats match.' : 'No chats yet. They appear when you send a message or someone writes to you.'}</div> : (
            <ul>{list.map((v) => (
              <li key={v.phone}><Link href={href({ c: v.phone })} className={`chat-row ${v.phone === open ? 'on' : ''}`} aria-current={v.phone === open ? 'true' : undefined}>
                <span className="chat-top"><b>{v.contactName || `+${v.phone}`}</b><span className="mut small">{shortTime(v.lastAt)}</span></span>
                <span className="chat-bot"><span className="chat-last">{v.lastDirection === 'out' ? 'You: ' : ''}{v.lastText}</span>{v.unread > 0 && <span className="chat-unread" aria-label={`${v.unread} unread`}>{v.unread}</span>}</span>
              </Link></li>
            ))}</ul>
          )}
          {more && <Link className="btn" href={href({ n: String(limit + STEP) })}>Show more</Link>}
        </aside>
        <section className="chat-pane">{thread}</section>
      </div>
    </>
  );
}
