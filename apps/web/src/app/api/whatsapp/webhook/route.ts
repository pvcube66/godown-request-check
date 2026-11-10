import { openSecret, processWebhook, getWhatsAppSettings, verifyChallenge, verifySignature } from '@anomaly/core';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BYTES = 1_000_000;

/** Meta's setup handshake. Answers only when the token matches the one saved in WhatsApp settings. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const s = await getWhatsAppSettings(await getDb());
  if (!verifyChallenge(u.searchParams.get('hub.mode'), u.searchParams.get('hub.verify_token'), s.verifyToken)) return new Response('Forbidden', { status: 403 });
  return new Response(u.searchParams.get('hub.challenge') ?? '', { status: 200 });
}

/** Delivery ticks and replies. This address has no sign-in, so every request must carry Meta's signature (made with the app secret);
 *  anything unsigned, wrongly signed, or arriving before the app secret is saved is refused. */
export async function POST(req: Request) {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) return new Response('Too large', { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return new Response('Too large', { status: 413 });
  const c = await getDb();
  const s = await getWhatsAppSettings(c);
  let secret = '';
  try { secret = s.appSecretEnc ? openSecret(s.appSecretEnc) : ''; } catch { secret = ''; }
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'), secret)) return new Response('Bad signature', { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response('Bad request', { status: 400 }); }
  try { await processWebhook(c, body, s); } catch (e) { console.error('whatsapp webhook failed:', e instanceof Error ? e.message : e); return new Response('Error', { status: 500 }); }   // Meta will send it again
  return new Response('EVENT_RECEIVED', { status: 200 });
}
