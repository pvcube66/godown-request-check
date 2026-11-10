import { requireMasterAdmin } from '@/lib/master-auth';
import { importAction } from '../actions';
import { MAX_MAPPING_FILE_BYTES } from '../import-file';

export const runtime = 'nodejs';
export const maxDuration = 60;
const MAX_BODY_BYTES = MAX_MAPPING_FILE_BYTES + 64 * 1024;

/** A route avoids Next's smaller server-action body limit. Authenticate before
 * reading the body, require a same-origin browser, and bound multipart overhead too. */
export async function POST(request: Request): Promise<Response> {
  try { await requireMasterAdmin(); }
  catch { return Response.json({ error: 'Unlock master admin access before importing mappings.' }, { status: 403 }); }
  const origin = request.headers.get('origin');
  try {
    if (!origin || new URL(origin).origin !== new URL(request.url).origin) throw new Error('Cross-origin request');
  } catch { return Response.json({ error: 'Import must be submitted from this dashboard.' }, { status: 403 }); }
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('multipart/form-data;')) return Response.json({ error: 'Choose a mapping file using the upload form.' }, { status: 415 });
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY_BYTES) return Response.json({ error: 'Mapping files must be 2 MB or smaller.' }, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: 'Choose a non-empty mapping file.' }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        return Response.json({ error: 'Mapping files must be 2 MB or smaller.' }, { status: 413 });
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    const form = await new Response(bytes, { headers: { 'content-type': type } }).formData();
    const result = await importAction({}, form);
    return Response.json(result, { status: result.error ? 400 : 200 });
  } catch { return Response.json({ error: 'Could not read the upload. Choose a fresh CSV or XLSX file and try again.' }, { status: 400 }); }
}
