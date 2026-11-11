import { getDb } from '@/lib/db';
import { masterAdminAccess } from '@/lib/master-auth';
import WaSettingsTabs from '@/components/WaSettingsTabs';
import QuickReplies from './QuickReplies';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quick replies' };

export default async function Quick() {
  if (!(await masterAdminAccess()).authorized) return <div className="master-page"><header className="master-header"><h1>Quick replies</h1></header><section className="master-section master-gate"><h2>Administrators only</h2><p>Quick replies are managed by an administrator.</p></section></div>;
  const list = await (await getDb()).waQuickReplies.find({}).sort({ title: 1 }).limit(100).toArray();
  return (
    <>
      <section className="hero"><h1>WhatsApp settings</h1><p className="lede">Short answers you can add to a chat reply with one click.</p></section>
      <WaSettingsTabs active="quick" />
      <QuickReplies list={list.map((q) => ({ title: q.title, text: q.text }))} />
    </>
  );
}
