import type { Collection } from 'mongodb';
import type { Collections } from './db.js';
import { credentialsOf, WhatsAppInputError, type WhatsAppSettings } from './whatsapp.js';
import { GRAPH_URL, WhatsAppApiError, type Fetcher } from './whatsappApi.js';

/** The business profile shown to people on WhatsApp (about, description, address, email, websites), read from and saved to Meta. */

import { VERTICALS, type BusinessProfile } from './whatsappProfileRules.js';
export * from './whatsappProfileRules.js';

const FIELDS = 'about,address,description,email,profile_picture_url,websites,vertical';
async function graph(f: Fetcher, url: string, token: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await f(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000) });
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* not JSON */ }
  if (!res.ok) { const e = (body.error ?? {}) as { code?: number | string; message?: string; error_user_msg?: string }; throw new WhatsAppApiError(`${e.code ?? res.status}: ${e.error_user_msg ?? e.message ?? `HTTP ${res.status}`}`, String(e.code ?? res.status), res.status); }
  return body;
}

/** Checks what was typed against WhatsApp's limits. Returns the cleaned profile or throws a message in plain words. */
export function validateProfile(p: BusinessProfile): BusinessProfile {
  const t = (v: string) => v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  const about = t(p.about), description = t(p.description), address = t(p.address), email = t(p.email);
  if (about.length > 139) throw new WhatsAppInputError('The short “About” line can be at most 139 letters.');
  if (description.length > 512) throw new WhatsAppInputError('The description can be at most 512 letters.');
  if (address.length > 256) throw new WhatsAppInputError('The address can be at most 256 letters.');
  if (email && (email.length > 128 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new WhatsAppInputError('Enter a valid email address.');
  const websites = p.websites.map(t).filter(Boolean);
  if (websites.length > 2) throw new WhatsAppInputError('WhatsApp allows up to 2 websites.');
  for (const w of websites) { if (w.length > 256 || !/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(w)) throw new WhatsAppInputError(`“${w.slice(0, 40)}” is not a web address. Start it with http:// or https://.`); }
  if (!VERTICALS.some(([k]) => k === p.vertical)) throw new WhatsAppInputError('Choose a type of business from the list.');
  return { about, description, address, email, websites, vertical: p.vertical, pictureUrl: '' };
}

function need(s: WhatsAppSettings) { const cred = credentialsOf(s); if (!cred) throw new WhatsAppInputError('Connect WhatsApp first.'); return cred; }

export async function fetchBusinessProfile(s: WhatsAppSettings, f: Fetcher = fetch): Promise<BusinessProfile> {
  const cred = need(s);
  const body = await graph(f, `${GRAPH_URL}/${encodeURIComponent(cred.phoneNumberId)}/whatsapp_business_profile?${new URLSearchParams({ fields: FIELDS })}`, cred.accessToken);
  const d = ((body.data as Record<string, unknown>[] | undefined)?.[0] ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');
  return { about: str('about'), description: str('description'), address: str('address'), email: str('email'), websites: Array.isArray(d.websites) ? (d.websites as unknown[]).filter((w): w is string => typeof w === 'string') : [], vertical: str('vertical'), pictureUrl: str('profile_picture_url') };
}

export async function saveBusinessProfile(c: Pick<Collections, 'settings' | 'auditLog'>, s: WhatsAppSettings, p: BusinessProfile, actor: string, f: Fetcher = fetch): Promise<BusinessProfile> {
  const cred = need(s);
  const v = validateProfile(p);
  await graph(f, `${GRAPH_URL}/${encodeURIComponent(cred.phoneNumberId)}/whatsapp_business_profile`, cred.accessToken, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', about: v.about, description: v.description, address: v.address, email: v.email, websites: v.websites, ...(v.vertical ? { vertical: v.vertical } : {}) }) });
  await c.auditLog.insertOne({ actor, action: 'whatsapp.profile', target: 'whatsapp', at: new Date() });
  return v;
}

// ----- quick replies: short saved answers for the chat reply box -----
export interface QuickReplyDoc { title: string; text: string; createdAt: Date }
export interface QuickReplyCollections { waQuickReplies: Collection<QuickReplyDoc>; auditLog: Collection<{ actor: string; action: string; target: string; at: Date }> }
export const MAX_QUICK_REPLIES = 50;

export async function addQuickReply(c: QuickReplyCollections, title: string, text: string, actor: string): Promise<void> {
  const t = title.trim().replace(/\s+/g, ' '), x = text.trim();
  if (t.length < 1 || t.length > 30) throw new WhatsAppInputError('Give it a short title (up to 30 letters).');
  if (x.length < 1 || x.length > 1000) throw new WhatsAppInputError('Type the reply (up to 1000 letters).');
  if ((await c.waQuickReplies.countDocuments()) >= MAX_QUICK_REPLIES) throw new WhatsAppInputError(`You can save up to ${MAX_QUICK_REPLIES} quick replies. Delete one first.`);
  try { await c.waQuickReplies.insertOne({ title: t, text: x, createdAt: new Date() }); }
  catch (e) { if ((e as { code?: number }).code === 11000) throw new WhatsAppInputError('A quick reply with that title already exists.'); throw e; }
  await c.auditLog.insertOne({ actor, action: 'quick-reply.add', target: t, at: new Date() });
}
export async function deleteQuickReply(c: QuickReplyCollections, title: string, actor: string): Promise<void> {
  const r = await c.waQuickReplies.deleteOne({ title });
  if (r.deletedCount !== 1) throw new WhatsAppInputError('That quick reply no longer exists.');
  await c.auditLog.insertOne({ actor, action: 'quick-reply.delete', target: title, at: new Date() });
}
