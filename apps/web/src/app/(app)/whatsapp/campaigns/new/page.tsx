import { masterAdminAccess } from '@/lib/master-auth';
import { getDb } from '@/lib/db';
import NewCampaign from './NewCampaign';
import { tagCounts } from '@anomaly/core';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New campaign' };

export default async function NewCampaignPage() {
  if (!(await masterAdminAccess()).authorized) return <div className="master-page"><header className="master-header"><h1>New campaign</h1></header><section className="master-section master-gate"><h2>Administrators only</h2><p>Campaigns are managed by an administrator.</p></section></div>;
  const c = await getDb();
  const [templates, groups, tags] = await Promise.all([c.waTemplates.find({ status: 'APPROVED' }).sort({ name: 1 }).limit(200).toArray(), c.waGroups.find({}, { projection: { name: 1, members: 1 } }).sort({ name: 1 }).toArray(), tagCounts(c)]);
  return (
    <>
      <section className="hero"><h1>New campaign</h1><p className="lede">Pick the message and the people. You review before anything is sent.</p></section>
      <NewCampaign templates={templates.map((t) => ({ name: t.name, language: t.language, body: t.bodyText, header: t.form?.headerText ?? '' }))} groups={groups.map((g) => ({ name: g.name, count: g.members.length }))} tags={tags.slice(0, 30)} />
    </>
  );
}
