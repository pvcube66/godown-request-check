import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Collection } from 'mongodb';
import type { Collections } from './db.js';
import { openSecret, sealSecret } from './secretBox.js';
import { getMetaFailureCopy, parseMetaCode } from './metaErrorCopy.js';
import { createTemplate, getTemplateStatus, type Fetcher, type WaCredentials } from './whatsappApi.js';

/** WhatsApp reminders: settings, the message wording, the message history, and what Meta tells us back (delivery ticks and replies).
 *  Messages go out from the CLIENT's own WhatsApp business account (decision D7). Nothing here ever writes to the government portal. */

// ----- the template (see docs/templates/whatsapp-reminder-template.md) -----
export const TEMPLATE_NAME = 'order_not_acknowledged';
export const TEMPLATE_LANGUAGE = 'en';
export const TEMPLATE_BODY = 'Hello {{1}}, the delivery for request {{2}} was dispatched on {{3}} and has not been acknowledged on the portal yet. Please log in and acknowledge it. {{4}} Thank you.';
export const REMINDER_LINES = [
  'This is the first reminder.',
  'This is the second reminder. Please acknowledge today.',
  'This is the third reminder. The godown is waiting for your acknowledgement.',
  'This is the final reminder. Please contact the godown if there is a problem.',
] as const;
/** Meta needs sample values for each {{n}} when a template is submitted. */
export const TEMPLATE_EXAMPLE = ['Govt BC Boys Hostel Kalwakurthy', 'IR202600009266', '06 Nov 2026', REMINDER_LINES[0]];
export const MAX_REMINDERS = REMINDER_LINES.length;

// ----- settings -----
export type WhatsAppMode = 'off' | 'dry_run' | 'live';
export interface WhatsAppSettings {
  mode: WhatsAppMode;                      // dry_run = work out who would be messaged, send nothing
  phoneNumberId: string; wabaId: string;
  accessTokenEnc: string | null; appSecretEnc: string | null;      // sealed like the portal passwords; never shown
  verifyToken: string;                     // pasted into Meta when the webhook is set up
  templateName: string; language: string;
  templateStatus: string | null; templateReason: string | null; templateCheckedAt: Date | null;
  firstAfterDays: number; everyDays: number; maxMessages: number;   // approved rules (D9)
  windowFrom: number; windowTo: number;    // send only between these India-time hours (from inclusive, to exclusive)
  lastError: string | null; lastErrorAt: Date | null;
  updatedAt: Date;
}

export const DEFAULT_SETTINGS = (): WhatsAppSettings => ({
  mode: 'dry_run', phoneNumberId: '', wabaId: '', accessTokenEnc: null, appSecretEnc: null, verifyToken: randomBytes(18).toString('hex'),
  templateName: TEMPLATE_NAME, language: TEMPLATE_LANGUAGE, templateStatus: null, templateReason: null, templateCheckedAt: null,
  firstAfterDays: 3, everyDays: 2, maxMessages: 4, windowFrom: 9, windowTo: 18,
  lastError: null, lastErrorAt: null, updatedAt: new Date(),
});

export class WhatsAppInputError extends Error {}

type SettingsC = Pick<Collections, 'settings' | 'auditLog'>;
export async function getWhatsAppSettings(c: Pick<Collections, 'settings'>): Promise<WhatsAppSettings> {
  const saved = (await c.settings.findOne({ _id: 'whatsapp' }))?.value as Partial<WhatsAppSettings> | undefined;
  return { ...DEFAULT_SETTINGS(), ...(saved ?? {}) };
}

/** The verify token is created once and then kept, so Meta's saved copy keeps matching. */
export async function ensureWhatsAppSettings(c: Pick<Collections, 'settings'>): Promise<WhatsAppSettings> {
  const s = await getWhatsAppSettings(c);
  await c.settings.updateOne({ _id: 'whatsapp' }, { $setOnInsert: { value: s } }, { upsert: true });
  return (await getWhatsAppSettings(c));
}

export interface SettingsPatch {
  phoneNumberId?: string; wabaId?: string; accessToken?: string; appSecret?: string; templateName?: string; language?: string;
  firstAfterDays?: number; everyDays?: number; maxMessages?: number; windowFrom?: number; windowTo?: number; mode?: string;
}
const int = (v: number, lo: number, hi: number, what: string) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new WhatsAppInputError(`${what} must be a whole number from ${lo} to ${hi}.`);
  return v;
};
const idText = (v: string, what: string) => {
  const t = v.trim();
  if (t && !/^\d{5,25}$/.test(t)) throw new WhatsAppInputError(`${what} must be digits only (copy it from Meta).`);
  return t;
};

/** Saves changes. "Live" needs a complete, approved setup; secrets are stored sealed and an empty box leaves the saved one alone. */
export async function saveWhatsAppSettings(c: SettingsC, patch: SettingsPatch, actor: string): Promise<WhatsAppSettings> {
  const cur = await ensureWhatsAppSettings(c);
  const next: WhatsAppSettings = { ...cur, updatedAt: new Date() };
  if (patch.phoneNumberId !== undefined) next.phoneNumberId = idText(patch.phoneNumberId, 'Phone number ID');
  if (patch.wabaId !== undefined) next.wabaId = idText(patch.wabaId, 'WhatsApp business account ID');
  if (patch.accessToken?.trim()) { if (patch.accessToken.length > 1000) throw new WhatsAppInputError('The access key is too long.'); next.accessTokenEnc = sealSecret(patch.accessToken.trim()); next.lastError = null; next.lastErrorAt = null; }
  if (patch.appSecret?.trim()) { if (patch.appSecret.length > 200) throw new WhatsAppInputError('The app secret is too long.'); next.appSecretEnc = sealSecret(patch.appSecret.trim()); }
  if (patch.templateName !== undefined) { if (!/^[a-z0-9_]{1,512}$/.test(patch.templateName)) throw new WhatsAppInputError('Template names use lower-case letters, numbers and underscores only.'); if (patch.templateName !== cur.templateName) { next.templateStatus = null; next.templateReason = null; next.templateCheckedAt = null; } next.templateName = patch.templateName; }
  if (patch.language !== undefined) { if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(patch.language)) throw new WhatsAppInputError('Use a language code such as en or te.'); next.language = patch.language; }
  if (patch.firstAfterDays !== undefined) next.firstAfterDays = int(patch.firstAfterDays, 1, 30, 'Days before the first reminder');
  if (patch.everyDays !== undefined) next.everyDays = int(patch.everyDays, 1, 30, 'Days between reminders');
  if (patch.maxMessages !== undefined) next.maxMessages = int(patch.maxMessages, 1, MAX_REMINDERS, `Number of reminders (one to ${MAX_REMINDERS})`);
  if (patch.windowFrom !== undefined) next.windowFrom = int(patch.windowFrom, 0, 23, 'Earliest hour');
  if (patch.windowTo !== undefined) next.windowTo = int(patch.windowTo, 1, 24, 'Latest hour');
  if (next.windowFrom >= next.windowTo) throw new WhatsAppInputError('The earliest hour must be before the latest hour.');
  if (patch.mode !== undefined) {
    if (!['off', 'dry_run', 'live'].includes(patch.mode)) throw new WhatsAppInputError('Choose off, preview only, or live.');
    next.mode = patch.mode as WhatsAppMode;
  }
  if (next.mode === 'live') {
    const missing = [!next.phoneNumberId && 'phone number ID', !next.wabaId && 'business account ID', !next.accessTokenEnc && 'access key', !next.appSecretEnc && 'app secret'].filter(Boolean);
    if (missing.length) throw new WhatsAppInputError(`Live sending needs: ${missing.join(', ')}.`);
    if (next.templateStatus !== 'APPROVED') throw new WhatsAppInputError('Live sending needs the reminder template to be approved by WhatsApp. Submit it and refresh its status first.');
  }
  await c.settings.updateOne({ _id: 'whatsapp' }, { $set: { value: next } }, { upsert: true });
  await c.auditLog.insertOne({ actor, action: 'whatsapp.settings', target: 'whatsapp', at: new Date(), details: { mode: next.mode, rules: [next.firstAfterDays, next.everyDays, next.maxMessages], window: [next.windowFrom, next.windowTo], changedKeys: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined && k !== 'accessToken' && k !== 'appSecret'), secretsChanged: [!!patch.accessToken?.trim() && 'accessToken', !!patch.appSecret?.trim() && 'appSecret'].filter(Boolean) } });
  return next;
}

export function credentialsOf(s: WhatsAppSettings): WaCredentials | null {
  if (!s.phoneNumberId || !s.wabaId || !s.accessTokenEnc) return null;
  return { phoneNumberId: s.phoneNumberId, wabaId: s.wabaId, accessToken: openSecret(s.accessTokenEnc) };
}

/** Records a problem for the settings page, and nothing else. */
export async function noteWhatsAppError(c: Pick<Collections, 'settings'>, message: string | null): Promise<void> {
  await c.settings.updateOne({ _id: 'whatsapp' }, { $set: { 'value.lastError': message, 'value.lastErrorAt': message ? new Date() : null } });
}

// ----- the wording sent in the four blanks -----
const clean = (v: string) => v.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 200);
/** Meta rules: a value may not contain line breaks, tabs, or runs of spaces. */
export function templateValues(o: { hostelName: string; requestId: string; dispatchedOn: Date }, reminderNo: number, hostelLabel: (n: string) => string): string[] {
  const line = REMINDER_LINES[Math.min(Math.max(reminderNo, 1), MAX_REMINDERS) - 1]!;
  const day = o.dispatchedOn.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  return [clean(hostelLabel(o.hostelName)) || 'Hostel', clean(o.requestId), day, line];
}
export const renderTemplate = (values: readonly string[]) => values.reduce((t, v, i) => t.replace(`{{${i + 1}}}`, v), TEMPLATE_BODY);

/** A 10-digit Indian mobile number (6-9 first), with or without 91 or +91, becomes 91XXXXXXXXXX. Anything else is not used. */
export function whatsappNumber(raw: string | undefined | null): string | null {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '');
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 10 ? digits : '';
  return /^[6-9]\d{9}$/.test(ten) ? `91${ten}` : null;
}

// ----- message history -----
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
export interface WhatsAppMessageDoc {
  /** requestId|reminderNo for a reminder that is counted. Unique, so a reminder can never be sent twice, even if two runs overlap. Removed if Meta refused the send, so it can be tried again. */
  sendKey?: string;
  messageId: string | null;
  direction: 'out' | 'in';
  requestId: string | null; hostelCode: string; hostelName: string; districtName: string;
  phoneLast4: string;                      // the full number is not copied into the history
  template?: string; reminderNo?: number;
  text: string;                            // what was sent, or the reply
  status: MessageStatus;
  counted: boolean;                        // false when Meta refused the send, so it does not use up a reminder
  errorCode?: string; errorText?: string;
  createdAt: Date; statusAt: Date;
}
export interface WhatsAppCollections extends Pick<Collections, 'settings' | 'auditLog' | 'orders' | 'hostelsMaster' | 'godowns'> { whatsappMessages: Collection<WhatsAppMessageDoc> }

const ALLOWED_FROM: Record<'sent' | 'delivered' | 'read' | 'failed', MessageStatus[]> = {
  sent: ['queued'],
  delivered: ['queued', 'sent'],
  read: ['queued', 'sent', 'delivered'],
  failed: ['queued', 'sent', 'delivered'],
};

/** Applies a delivery update from Meta. A late "sent" never undoes "delivered" or "read", and a repeated update changes nothing. */
export async function applyDeliveryStatus(c: Pick<WhatsAppCollections, 'whatsappMessages'>, messageId: string, status: string, errors: { code?: number | string; title?: string; message?: string }[] | undefined, at = new Date()): Promise<boolean> {
  if (!(status in ALLOWED_FROM)) return false;
  const s = status as keyof typeof ALLOWED_FROM;
  const errorText = s === 'failed' ? (errors ?? []).map((e) => `${e.code ?? ''}: ${e.title ?? e.message ?? ''}`).join('; ') || 'Failed' : undefined;
  const set: Partial<WhatsAppMessageDoc> = { status: s, statusAt: at, ...(errorText ? { errorText, errorCode: parseMetaCode(errorText) } : {}) };
  const r = await c.whatsappMessages.updateOne({ messageId, direction: 'out', status: { $in: ALLOWED_FROM[s] } }, { $set: set });
  return r.matchedCount === 1;
}

const STOP_WORDS = /^\s*(stop|unsubscribe|opt[ -]?out|stop messages)\s*[.!]*\s*$/i;
export const isStopMessage = (text: string) => STOP_WORDS.test(text);

/** Reads what Meta posted: delivery ticks for messages we sent, and replies from hostels. Events for another phone number are ignored. */
export async function processWebhook(c: WhatsAppCollections, payload: unknown, settings: Pick<WhatsAppSettings, 'phoneNumberId'>, now = new Date()): Promise<{ statuses: number; replies: number; optOuts: number }> {
  const out = { statuses: 0, replies: 0, optOuts: 0 };
  const entries = (payload as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) for (const change of ((entry as { changes?: unknown[] })?.changes ?? []) as { value?: Record<string, unknown> }[]) {
    const v = change?.value; if (!v) continue;
    if ((v.metadata as { phone_number_id?: string } | undefined)?.phone_number_id !== settings.phoneNumberId) continue;
    for (const st of (v.statuses as { id?: string; status?: string; errors?: { code?: number; title?: string; message?: string }[]; timestamp?: string }[] | undefined) ?? []) {
      if (st.id && st.status && await applyDeliveryStatus(c, st.id, st.status, st.errors, st.timestamp ? new Date(Number(st.timestamp) * 1000) : now)) out.statuses++;
    }
    for (const m of (v.messages as { id?: string; from?: string; type?: string; text?: { body?: string } }[] | undefined) ?? []) {
      const ten = String(m.from ?? '').replace(/[^0-9]/g, '').slice(-10);
      if (!m.id || ten.length !== 10) continue;
      const hostel = await c.hostelsMaster.findOne({ hostelPhone: ten });
      if (!hostel) continue;                                 // not one of our hostels' numbers: not stored
      const text = m.type === 'text' ? String(m.text?.body ?? '').slice(0, 1000) : `[${m.type ?? 'message'}]`;
      const lastOut = await c.whatsappMessages.findOne({ direction: 'out', hostelCode: hostel.hostelCode }, { sort: { createdAt: -1 } });
      try {
        await c.whatsappMessages.insertOne({ messageId: m.id, direction: 'in', requestId: lastOut?.requestId ?? null, hostelCode: hostel.hostelCode, hostelName: hostel.hostelName, districtName: hostel.districtName, phoneLast4: ten.slice(-4), text, status: 'received', counted: false, createdAt: now, statusAt: now });
        out.replies++;
      } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; continue; }   // Meta redelivered it
      if (isStopMessage(text)) {
        await c.hostelsMaster.updateOne({ godownId: hostel.godownId, hostelCode: hostel.hostelCode }, { $set: { whatsappOptOut: true, whatsappOptOutAt: now, updatedAt: now } });
        await c.auditLog.insertOne({ actor: 'whatsapp', action: 'whatsapp.opt-out', target: `hostel:${hostel.godownId}:${hostel.hostelCode}`, at: now });
        out.optOuts++;
      }
    }
  }
  return out;
}

// ----- webhook security -----
/** Meta signs every webhook body with the app secret. Anything unsigned or wrongly signed is rejected (checked in constant time). */
export function verifySignature(rawBody: string | Buffer, header: string | null | undefined, appSecret: string): boolean {
  if (!header || !appSecret || !header.startsWith('sha256=')) return false;
  const want = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const got = Buffer.from(header.slice('sha256='.length));
  return want.length === got.length && timingSafeEqual(want, got);
}
export function verifyChallenge(mode: string | null, token: string | null, expected: string): boolean {
  if (mode !== 'subscribe' || !token || !expected) return false;
  const a = Buffer.from(token), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** One failed message in words a non-technical person can read. */
export const failureText = (m: Pick<WhatsAppMessageDoc, 'errorText'>) => (m.errorText ? getMetaFailureCopy(m.errorText) : null);

// ----- template approval (talks to Meta) -----

/** Submits the reminder wording to WhatsApp for approval. */
export async function submitReminderTemplate(c: SettingsC, actor: string, f?: Fetcher): Promise<string> {
  const s = await ensureWhatsAppSettings(c);
  const cred = credentialsOf(s);
  if (!cred) throw new WhatsAppInputError('Save the phone number ID, business account ID and access key first.');
  const r = await createTemplate(cred, { name: s.templateName, language: s.language, category: 'UTILITY', bodyText: TEMPLATE_BODY, example: [...TEMPLATE_EXAMPLE] }, f);
  await c.settings.updateOne({ _id: 'whatsapp' }, { $set: { 'value.templateStatus': r.status, 'value.templateReason': null, 'value.templateCheckedAt': new Date() } });
  await c.auditLog.insertOne({ actor, action: 'whatsapp.template.submit', target: s.templateName, at: new Date(), details: { status: r.status } });
  return r.status;
}

/** Asks WhatsApp whether the template has been approved. If it is no longer approved while sending is live, sending falls back to preview. */
export async function refreshTemplateStatus(c: SettingsC, f?: Fetcher): Promise<string | null> {
  const s = await ensureWhatsAppSettings(c);
  const cred = credentialsOf(s);
  if (!cred) throw new WhatsAppInputError('Save the phone number ID, business account ID and access key first.');
  const r = await getTemplateStatus(cred, s.templateName, s.language, f);
  const set: Record<string, unknown> = { 'value.templateStatus': r?.status ?? null, 'value.templateReason': r?.reason || null, 'value.templateCheckedAt': new Date() };
  if (s.mode === 'live' && r?.status !== 'APPROVED') set['value.mode'] = 'dry_run';
  await c.settings.updateOne({ _id: 'whatsapp' }, { $set: set });
  return r?.status ?? null;
}
