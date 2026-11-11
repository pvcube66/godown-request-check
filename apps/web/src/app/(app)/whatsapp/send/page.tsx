import Link from 'next/link';
import { isConnected, ensureWhatsAppSettings } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { masterAdminAccess } from '@/lib/master-auth';
import SendClient from './SendClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Send message' };

export default async function Send({ searchParams }: { searchParams: Promise<{ to?: string; group?: string; template?: string }> }) {
  if (!(await masterAdminAccess()).authorized) return <div className="master-page"><header className="master-header"><h1>Send message</h1></header><section className="master-section master-gate"><h2>Administrators only</h2><p>Messages are sent by an administrator.</p></section></div>;
  const sp = await searchParams;
  const c = await getDb();
  const s = await ensureWhatsAppSettings(c);
  const [templates, contacts, groups] = await Promise.all([
    c.waTemplates.find({ status: 'APPROVED' }).sort({ name: 1 }).limit(200).toArray(),
    c.waContacts.find({ optedOut: false }, { projection: { phone: 1, name: 1 } }).sort({ name: 1, phone: 1 }).limit(1000).toArray(),
    c.waGroups.find({}, { projection: { name: 1, members: 1 } }).sort({ name: 1 }).toArray(),
  ]);
  return (
    <>
      <section className="hero"><h1>Send message</h1><p className="lede">Send an approved message to people you have saved. You always see a preview first.</p></section>
      {!isConnected(s) && <p className="alert-bar" role="status">WhatsApp is not connected yet, so nothing can be sent. <Link href="/whatsapp/connect">Connect WhatsApp</Link></p>}
      {isConnected(s) && s.mode !== 'live' && <p className="alert-bar" role="status">WhatsApp is in {s.mode === 'off' ? 'off' : 'preview'} mode: you can preview messages, but nothing is sent until sending is switched to live.</p>}
      <SendClient
        mode={s.mode}
        templates={templates.map((t) => ({ name: t.name, language: t.language, body: t.bodyText, header: t.form?.headerText ?? '', footer: t.form?.footer ?? '', examples: t.form?.examples ?? [], headerExample: t.form?.headerExample ?? '' }))}
        contacts={contacts.map((p) => ({ phone: p.phone, name: p.name }))}
        groups={groups.map((g) => ({ name: g.name, count: g.members.length }))}
        initial={{ to: /^\d{8,15}$/.test(sp.to ?? '') ? sp.to! : '', group: sp.group ?? '', template: sp.template ?? '' }}
      />
    </>
  );
}
