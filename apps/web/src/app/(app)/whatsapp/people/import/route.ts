import { ContactInputError, importContacts } from '@anomaly/core';
import { MAX_CONTACT_FILE_BYTES, parseContactsUpload } from '@/lib/contacts-file';
import { getDb } from '@/lib/db';
import { actorOf, requireAccess } from '@/lib/viewer';

export const runtime = 'nodejs';
export const maxDuration = 60;
const MAX_BODY = MAX_CONTACT_FILE_BYTES + 64 * 1024;

/** Check a contacts file (commit=0) or save it (commit=1). Administrators only, same origin only, size-limited before reading. */
export async function POST(request: Request): Promise<Response> {
  let viewer;
  try { viewer = await requireAccess('admin'); } catch { return Response.json({ error: 'Only an administrator can import contacts.' }, { status: 403 }); }
  try { if (new URL(request.headers.get('origin') ?? '').origin !== new URL(request.url).origin) throw new Error('x'); } catch { return Response.json({ error: 'Import must be submitted from this dashboard.' }, { status: 403 }); }
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data;')) return Response.json({ error: 'Choose a file using the form.' }, { status: 415 });
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(declared) || declared > MAX_BODY) return Response.json({ error: 'Files must be 2 MB or smaller.' }, { status: 413 });
  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length > MAX_BODY) return Response.json({ error: 'Files must be 2 MB or smaller.' }, { status: 413 });
    const form = await new Response(bytes, { headers: { 'content-type': request.headers.get('content-type')! } }).formData();
    const file = form.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return Response.json({ error: 'Choose a .csv or .xlsx file.' }, { status: 400 });
    const rows = await parseContactsUpload(file);
    const tags = String(form.get('tags') ?? '').slice(0, 200).split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
    const group = String(form.get('group') ?? '').slice(0, 100) || undefined;
    const commit = form.get('commit') === '1';
    const c = await getDb();
    if (group && !(await c.waGroups.findOne({ name: group }))) return Response.json({ error: 'That group no longer exists.' }, { status: 400 });
    const r = await importContacts(c, rows, { commit, tags, ...(group ? { group } : {}), source: 'import' }, actorOf(viewer));
    return Response.json({ ...r, skipped: r.skipped.slice(0, 20), moreSkipped: Math.max(0, r.skipped.length - 20), committed: commit });
  } catch (e) {
    return Response.json({ error: e instanceof ContactInputError || e instanceof Error ? e.message.slice(0, 300) : 'Could not read the file.' }, { status: 400 });
  }
}
