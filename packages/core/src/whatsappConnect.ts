import type { Collections } from './db.js';
import { openSecret, sealSecret } from './secretBox.js';
import { GRAPH_URL, WhatsAppApiError, type Fetcher } from './whatsappApi.js';
import { ensureWhatsAppSettings, WhatsAppInputError, type WhatsAppSettings } from './whatsapp.js';

/** "Connect WhatsApp": the setup flow of the team's TeleCRM (`whatsappOnboardingController.js`), rewritten for one business account.
 *  Two ways in: Meta's one-click Embedded Signup (a code, exchanged here) or an existing permanent access token + phone number ID.
 *  Both discover the WhatsApp business account (WABA) from the token, find the phone number, subscribe our app to the WABA's webhooks,
 *  and register the number for the Cloud API. Only the token, WABA ID, phone number ID and display number are kept; nothing is written to the government portal. */

type ConnectC = Pick<Collections, 'settings' | 'auditLog'>;

async function graph(f: Fetcher, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await f(url, { ...init, signal: AbortSignal.timeout(15_000) });
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON */ }
  if (!res.ok) {
    const e = (body.error ?? {}) as { code?: number | string; message?: string };
    throw new WhatsAppApiError(`${e.code ?? res.status}: ${e.message ?? `HTTP ${res.status}`}`, String(e.code ?? res.status), res.status);
  }
  return body;
}
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export interface MetaApp { appId: string; appSecret: string }
export function metaAppOf(s: WhatsAppSettings): MetaApp | null {
  if (!s.appId || !s.appSecretEnc) return null;
  return { appId: s.appId, appSecret: openSecret(s.appSecretEnc) };
}
const appToken = (a: MetaApp) => `${a.appId}|${a.appSecret}`;

/** The one-time code from Meta's signup popup -> an access token. */
export async function exchangeCode(app: MetaApp, code: string, f: Fetcher = fetch): Promise<string> {
  const body = await graph(f, `${GRAPH_URL}/oauth/access_token?${q({ client_id: app.appId, client_secret: app.appSecret, code })}`);
  const token = body.access_token;
  if (typeof token !== 'string' || !token) throw new WhatsAppInputError('Meta did not return an access token for that sign-up.');
  return token;
}

export interface TokenInfo { valid: boolean; wabaId: string | null; scopes: string[] }
export async function inspectToken(app: MetaApp, token: string, f: Fetcher = fetch): Promise<TokenInfo> {
  const body = await graph(f, `https://graph.facebook.com/debug_token?${q({ input_token: token, access_token: appToken(app) })}`);
  const d = (body.data ?? {}) as { is_valid?: boolean; granular_scopes?: { scope: string; target_ids?: string[] }[] };
  const scopes = d.granular_scopes ?? [];
  return { valid: d.is_valid === true, wabaId: scopes.find((s) => s.scope === 'whatsapp_business_management')?.target_ids?.[0] ?? null, scopes: scopes.map((s) => s.scope) };
}

export interface PhoneNumber { id: string; display: string; name: string }
export async function listPhoneNumbers(wabaId: string, token: string, f: Fetcher = fetch): Promise<PhoneNumber[]> {
  const body = await graph(f, `${GRAPH_URL}/${encodeURIComponent(wabaId)}/phone_numbers?${q({ access_token: token, fields: 'id,display_phone_number,verified_name' })}`);
  return ((body.data as { id: string; display_phone_number?: string; verified_name?: string }[] | undefined) ?? []).map((p) => ({ id: String(p.id), display: p.display_phone_number ?? '', name: p.verified_name ?? '' }));
}

/** Makes Meta send this app the delivery ticks and replies for the WABA. */
export async function subscribeWaba(wabaId: string, token: string, f: Fetcher = fetch): Promise<boolean> {
  const body = await graph(f, `${GRAPH_URL}/${encodeURIComponent(wabaId)}/subscribed_apps`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  return body.success === true;
}
export async function isWabaSubscribed(appId: string, wabaId: string, token: string, f: Fetcher = fetch): Promise<boolean> {
  const body = await graph(f, `${GRAPH_URL}/${encodeURIComponent(wabaId)}/subscribed_apps?${q({ access_token: token })}`);
  return ((body.data as { whatsapp_business_api_data?: { id?: string } }[] | undefined) ?? []).some((a) => String(a.whatsapp_business_api_data?.id) === String(appId));
}

/** Registers the number for the Cloud API (needed once for a fresh number). A random 6-digit PIN is used, as in the CRM. */
export async function registerPhone(phoneNumberId: string, token: string, f: Fetcher = fetch): Promise<void> {
  const pin = String(100000 + Math.floor(Math.random() * 900000));
  await graph(f, `${GRAPH_URL}/${encodeURIComponent(phoneNumberId)}/register`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', pin }) });
}

const audit = (c: ConnectC, actor: string, action: string, details?: unknown) =>
  c.auditLog.insertOne({ actor, action, target: 'whatsapp', at: new Date(), ...(details === undefined ? {} : { details }) });

async function save(c: ConnectC, p: { token: string; wabaId: string; phone: PhoneNumber }, actor: string, how: string) {
  await ensureWhatsAppSettings(c);
  await c.settings.updateOne({ _id: 'whatsapp' }, { $set: {
    'value.accessTokenEnc': sealSecret(p.token), 'value.wabaId': p.wabaId, 'value.phoneNumberId': p.phone.id,
    'value.displayPhone': p.phone.display, 'value.verifiedName': p.phone.name, 'value.connectedAt': new Date(),
    'value.lastError': null, 'value.lastErrorAt': null, 'value.updatedAt': new Date(),
  } });
  await audit(c, actor, 'whatsapp.connect', { how, wabaId: p.wabaId, phoneNumberId: p.phone.id, display: p.phone.display });
}

export interface Connected { wabaId: string; phoneNumberId: string; displayPhone: string; webhookSubscribed: boolean; registered: boolean }

async function finish(c: ConnectC, app: MetaApp, token: string, wantedPhoneId: string | null, actor: string, how: string, f: Fetcher): Promise<Connected> {
  const info = await inspectToken(app, token, f);
  if (!info.valid) throw new WhatsAppInputError('Meta says this access token is not valid, or it has expired.');
  if (!info.wabaId) throw new WhatsAppInputError('This token has no access to a WhatsApp Business Account. Create it with the whatsapp_business_management and whatsapp_business_messaging permissions.');
  const phones = await listPhoneNumbers(info.wabaId, token, f);
  const phone = wantedPhoneId ? phones.find((p) => p.id === wantedPhoneId) : phones[0];
  if (!phone) throw new WhatsAppInputError(wantedPhoneId ? `Phone number ID ${wantedPhoneId} was not found in this WhatsApp account. Numbers there: ${phones.map((p) => `${p.display} (${p.id})`).join(', ') || 'none'}.` : 'No phone number was found in that WhatsApp Business Account.');
  await save(c, { token, wabaId: info.wabaId, phone }, actor, how);
  let webhookSubscribed = false, registered = false;
  try { webhookSubscribed = await subscribeWaba(info.wabaId, token, f); } catch { /* shown on the verify step with a fix button */ }
  try { await registerPhone(phone.id, token, f); registered = true; } catch { /* already registered numbers refuse: fine */ }
  return { wabaId: info.wabaId, phoneNumberId: phone.id, displayPhone: phone.display, webhookSubscribed, registered };
}

/** Embedded Signup: the popup gave us a code. */
export async function connectWithCode(c: ConnectC, s: WhatsAppSettings, code: string, actor: string, f: Fetcher = fetch): Promise<Connected> {
  const app = metaAppOf(s);
  if (!app) throw new WhatsAppInputError('Save the Meta App ID and App secret first.');
  if (!code.trim() || code.length > 2000) throw new WhatsAppInputError('Missing sign-up code.');
  return finish(c, app, await exchangeCode(app, code.trim(), f), null, actor, 'embedded-signup', f);
}

/** An existing permanent access token and the phone number ID from the Meta dashboard. */
export async function connectManual(c: ConnectC, s: WhatsAppSettings, token: string, phoneNumberId: string, actor: string, f: Fetcher = fetch): Promise<Connected> {
  const app = metaAppOf(s);
  if (!app) throw new WhatsAppInputError('Save the Meta App ID and App secret first.');
  const t = token.trim(), id = phoneNumberId.trim();
  if (!t || !id) throw new WhatsAppInputError('Both the access token and the phone number ID are needed.');
  if (t.length > 1000 || !/^\d{5,25}$/.test(id)) throw new WhatsAppInputError('The phone number ID is digits only (copy it from the Meta dashboard).');
  return finish(c, app, t, id, actor, 'access-token', f);
}

export interface ConnectionStatus {
  connected: boolean;
  variables: { wabaId: string; phoneNumberId: string; displayPhone: string; verifiedName: string; connectedAt: Date | null } | null;
  checks: { tokenValid: boolean; webhookSubscribed: boolean; templateApproved: boolean };
}

export const isConnected = (s: Pick<WhatsAppSettings, 'phoneNumberId' | 'wabaId' | 'accessTokenEnc'>) => !!(s.phoneNumberId && s.wabaId && s.accessTokenEnc);

/** What the verify step shows: the discovered values and live checks against Meta (never throws for a failed check; that just means "not OK"). */
export async function connectionStatus(s: WhatsAppSettings, f: Fetcher = fetch): Promise<ConnectionStatus> {
  if (!isConnected(s)) return { connected: false, variables: null, checks: { tokenValid: false, webhookSubscribed: false, templateApproved: false } };
  const app = metaAppOf(s);
  const token = openSecret(s.accessTokenEnc!);
  let tokenValid = false, webhookSubscribed = false;
  if (app) {
    try { tokenValid = (await inspectToken(app, token, f)).valid; } catch { tokenValid = false; }
    try { webhookSubscribed = await isWabaSubscribed(app.appId, s.wabaId, token, f); } catch { webhookSubscribed = false; }
  }
  return {
    connected: true,
    variables: { wabaId: s.wabaId, phoneNumberId: s.phoneNumberId, displayPhone: s.displayPhone ?? '', verifiedName: s.verifiedName ?? '', connectedAt: s.connectedAt ?? null },
    checks: { tokenValid, webhookSubscribed, templateApproved: s.templateStatus === 'APPROVED' },
  };
}

/** The "Auto-fix" button on the verify step. */
export async function fixWebhook(c: ConnectC, s: WhatsAppSettings, actor: string, f: Fetcher = fetch): Promise<boolean> {
  if (!isConnected(s)) throw new WhatsAppInputError('WhatsApp is not connected yet.');
  const ok = await subscribeWaba(s.wabaId, openSecret(s.accessTokenEnc!), f);
  await audit(c, actor, 'whatsapp.webhook-subscribe', { ok });
  return ok;
}

/** Forgets the connection (token, ids). The reminder rules stay; live sending falls back to preview. */
export async function disconnect(c: ConnectC, actor: string): Promise<void> {
  await ensureWhatsAppSettings(c);
  await c.settings.updateOne({ _id: 'whatsapp' }, { $set: {
    'value.accessTokenEnc': null, 'value.wabaId': '', 'value.phoneNumberId': '', 'value.displayPhone': null, 'value.verifiedName': null, 'value.connectedAt': null,
    'value.mode': 'dry_run', 'value.templateStatus': null, 'value.templateReason': null, 'value.updatedAt': new Date(),
  } });
  await audit(c, actor, 'whatsapp.disconnect');
}

/** Saves the Meta app the connection goes through (App ID, App secret, and the Embedded Signup configuration ID if used). */
export async function saveMetaApp(c: ConnectC, input: { appId?: string; appSecret?: string; configId?: string }, actor: string): Promise<void> {
  await ensureWhatsAppSettings(c);
  const set: Record<string, unknown> = { 'value.updatedAt': new Date() };
  if (input.appId !== undefined) { const v = input.appId.trim(); if (v && !/^\d{5,25}$/.test(v)) throw new WhatsAppInputError('The Meta App ID is digits only.'); set['value.appId'] = v; }
  if (input.configId !== undefined) { const v = input.configId.trim(); if (v && !/^\d{5,25}$/.test(v)) throw new WhatsAppInputError('The Embedded Signup configuration ID is digits only.'); set['value.configId'] = v; }
  if (input.appSecret?.trim()) { if (input.appSecret.length > 200) throw new WhatsAppInputError('The app secret is too long.'); set['value.appSecretEnc'] = sealSecret(input.appSecret.trim()); }
  await c.settings.updateOne({ _id: 'whatsapp' }, { $set: set });
  await audit(c, actor, 'whatsapp.meta-app', { appId: input.appId, configId: input.configId, secretChanged: !!input.appSecret?.trim() });
}
