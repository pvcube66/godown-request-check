import { contactFilter } from '@anomaly/core';
import { csvResponse } from '@/lib/csv';
import { getDb } from '@/lib/db';
import { AccessError, actorOf, requireAccess } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

/** All people (or the current search / tag) as Excel-friendly CSV. Administrators only; logged. */
export async function GET(req: Request) {
  let viewer;
  try { viewer = await requireAccess('admin'); } catch (e) { return new Response('Only an administrator can download contacts.', { status: e instanceof AccessError ? e.status : 401 }); }
  const u = new URL(req.url);
  const c = await getDb();
  const list = await c.waContacts.find(contactFilter({ q: u.searchParams.get('q') ?? '', tag: u.searchParams.get('tag') ?? '' })).sort({ name: 1 }).limit(20000).toArray();
  await c.auditLog.insertOne({ actor: actorOf(viewer), action: 'export.contacts', target: 'whatsapp', at: new Date(), details: { rows: list.length } });
  return csvResponse(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, ['phone', 'name', 'email', 'tags', 'notes', 'status'], list.map((p) => [p.phone, p.name, p.email, p.tags.join(', '), p.notes, p.optedOut ? 'opted out' : 'ok']));
}
