import { randomUUID } from 'node:crypto';
import type { Collection } from 'mongodb';
import { getMetaFailureCopy } from './metaErrorCopy.js';
import { ACCOUNT_LEVEL } from './reminders.js';
import { credentialsOf, getWhatsAppSettings, noteWhatsAppError, WhatsAppInputError, type WhatsAppCollections, type WhatsAppMessageDoc, type WhatsAppSettings } from './whatsapp.js';
import { sendTemplateMessage, sendTextMessage, WhatsAppApiError, type Fetcher } from './whatsappApi.js';
import type { ContactDoc, GroupDoc } from './whatsappContacts.js';
import type { WaTemplateDoc } from './whatsappTemplates.js';
import { previewText, variablesIn } from './whatsappTemplateRules.js';
import type { SendSummary } from './whatsappSendRules.js';
export * from './whatsappSendRules.js';

/** Send Message: one approved template (or a text reply inside the 24-hour window) to chosen people. Preview first; opted-out people are never messaged. */

export interface SendCollections extends WhatsAppCollections { waContacts: Collection<ContactDoc>; waGroups: Collection<GroupDoc>; waTemplates: Collection<WaTemplateDoc> }

export const MAX_DIRECT = 50;                 // more than this belongs in a campaign
export const WINDOW_MS = 24 * 3600_000;
const clean = (v: string) => v.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 1000);

/** What blanks a template has: {{n}} in the body and in a text header. */
export function templateSlots(t: Pick<WaTemplateDoc, 'bodyText' | 'form'>): { body: number; header: number } {
  return { body: variablesIn(t.bodyText).length, header: t.form?.headerText ? variablesIn(t.form.headerText).length : 0 };
}

/** {name} becomes the person's first name (or "there"). Meta forbids line breaks, tabs and long runs of spaces in a value. */
export function fillValue(v: string, contact: Pick<ContactDoc, 'name'>): string {
  const first = contact.name.trim().split(/\s+/)[0] || 'there';
  return clean(v.replace(/\{name\}/gi, first));
}

export interface SendRequest { kind: 'template' | 'text'; template?: { name: string; language: string }; body?: string[]; header?: string[]; text?: string; phones: string[]; groups?: string[]; batchId?: string; campaignId?: string }

/** The people a request points to: chosen numbers plus group members, each once. */
export async function resolveRecipients(c: Pick<SendCollections, 'waContacts' | 'waGroups'>, phones: string[], groups: string[] = []): Promise<{ contacts: ContactDoc[]; unknown: string[] }> {
  const want = new Set(phones);
  if (groups.length) for (const g of await c.waGroups.find({ name: { $in: groups } }).toArray()) for (const m of g.members) want.add(m);
  const contacts = await c.waContacts.find({ phone: { $in: [...want] } }).toArray();
  const have = new Set(contacts.map((x) => x.phone));
  return { contacts, unknown: [...want].filter((p) => !have.has(p)) };
}

/** Last time this person wrote to us. The 24-hour window runs from there. */
export async function lastInboundAt(c: Pick<SendCollections, 'whatsappMessages'>, phone: string): Promise<Date | null> {
  const m = await c.whatsappMessages.findOne({ direction: 'in', phone }, { sort: { createdAt: -1 }, projection: { createdAt: 1 } });
  return m?.createdAt ?? null;
}
export const windowOpen = (last: Date | null, now = new Date()) => !!last && now.getTime() - last.getTime() < WINDOW_MS;

function checkRequest(r: SendRequest, tpl: WaTemplateDoc | null): void {
  if (r.kind === 'text') { if (!clean(r.text ?? '')) throw new WhatsAppInputError('Type the message first.'); if ((r.text ?? '').length > 4000) throw new WhatsAppInputError('That message is too long (4000 letters at most).'); return; }
  if (!r.template) throw new WhatsAppInputError('Choose a template.');
  if (!tpl) throw new WhatsAppInputError('That template is not saved here. Refresh the templates list.');
  if (tpl.status !== 'APPROVED') throw new WhatsAppInputError('Only approved templates can be sent.');
  const slots = templateSlots(tpl);
  const body = r.body ?? [], header = r.header ?? [];
  if (body.length !== slots.body || body.some((v) => !clean(v))) throw new WhatsAppInputError(`Fill in all ${slots.body} blank${slots.body === 1 ? '' : 's'} of the message.`);
  if (header.length !== slots.header || header.some((v) => !clean(v))) throw new WhatsAppInputError('Fill in the heading blank.');
}

/** Sends (or, with preview, only works out) a message to many people. Each result says what happened to that person. */
export async function sendMessages(c: SendCollections, req: SendRequest, opts: { preview: boolean; actor: string }, fetcher?: Fetcher, now = new Date()): Promise<SendSummary> {
  const s = await getWhatsAppSettings(c);
  const tpl = req.kind === 'template' && req.template ? await c.waTemplates.findOne({ name: req.template.name, language: req.template.language }) : null;
  checkRequest(req, tpl);
  const { contacts, unknown } = await resolveRecipients(c, req.phones, req.groups);
  if (contacts.length + unknown.length === 0) throw new WhatsAppInputError('Choose at least one person.');
  if (contacts.length + unknown.length > MAX_DIRECT) throw new WhatsAppInputError(`Send Message is for up to ${MAX_DIRECT} people at a time. Use a campaign for more.`);
  const live = s.mode === 'live' && !opts.preview;
  if (!opts.preview && s.mode === 'off') throw new WhatsAppInputError('WhatsApp sending is turned off. Turn it on in Settings.');
  if (!opts.preview && s.mode === 'dry_run') throw new WhatsAppInputError('WhatsApp is in preview mode, so nothing is sent. Switch to live in Settings when you are ready.');
  const cred = credentialsOf(s);
  if (live && !cred) throw new WhatsAppInputError('Connect WhatsApp first.');

  const batch = req.batchId || randomUUID();
  const out: SendSummary = { mode: s.mode, preview: !live, results: [], sent: 0, failed: 0, skipped: 0, stopped: null };
  for (const p of unknown) { out.results.push({ phone: p, name: '', outcome: 'not_saved', text: '' }); out.skipped++; }

  for (const ct of contacts) {
    const text = req.kind === 'text' ? clean(req.text ?? '') : previewText(tpl!.bodyText, (req.body ?? []).map((v) => fillValue(v, ct)));
    const base = { phone: ct.phone, name: ct.name, text };
    if (ct.optedOut) { out.results.push({ ...base, outcome: 'opted_out' }); out.skipped++; continue; }
    if (req.kind === 'text' && !windowOpen(await lastInboundAt(c, ct.phone), now)) { out.results.push({ ...base, outcome: 'outside_window' }); out.skipped++; continue; }
    if (out.stopped) { out.results.push({ ...base, outcome: 'failed', note: 'Not tried because an earlier message hit an account problem.' }); out.failed++; continue; }
    if (!live) { out.results.push({ ...base, outcome: 'would_send' }); continue; }

    const sendKey = `${batch}|${ct.phone}`;
    try {
      await c.whatsappMessages.insertOne({ sendKey, messageId: null, direction: 'out', requestId: null, hostelCode: '', hostelName: ct.name, districtName: '', phone: ct.phone, phoneLast4: ct.phone.slice(-4), kind: req.campaignId ? 'campaign' : 'single', ...(req.campaignId ? { campaignId: req.campaignId } : {}), sentBy: opts.actor, ...(req.kind === 'template' ? { template: req.template!.name } : {}), text, status: 'queued', counted: false, createdAt: now, statusAt: now });
    } catch (e) { if ((e as { code?: number }).code === 11000) { out.results.push({ ...base, outcome: 'failed', note: 'Already sent in this batch.' }); out.skipped++; continue; } throw e; }
    try {
      const id = req.kind === 'text'
        ? await sendTextMessage(cred!, ct.phone, text, fetcher)
        : await sendTemplateMessage(cred!, ct.phone, { ...req.template!, headerParams: (req.header ?? []).map((v) => fillValue(v, ct)) }, (req.body ?? []).map((v) => fillValue(v, ct)), fetcher);
      await c.whatsappMessages.updateOne({ sendKey }, { $set: { messageId: id, status: 'sent', statusAt: new Date() } });
      await c.waContacts.updateOne({ phone: ct.phone }, { $set: { lastMessagedAt: new Date() } });
      out.results.push({ ...base, outcome: 'sent' }); out.sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = e instanceof WhatsAppApiError ? e.code : '';
      const copy = getMetaFailureCopy(msg);
      await c.whatsappMessages.updateOne({ sendKey }, { $set: { status: 'failed', errorText: msg.slice(0, 300), errorCode: code, statusAt: new Date() }, $unset: { sendKey: '' } });
      out.results.push({ ...base, outcome: 'failed', note: `${copy.title}. ${copy.action}` }); out.failed++;
      if (ACCOUNT_LEVEL.has(code) || !(e instanceof WhatsAppApiError)) { out.stopped = copy.title; await noteWhatsAppError(c, `${copy.title}. ${copy.action}`); }
    }
  }
  await c.auditLog.insertOne({ actor: opts.actor, action: live ? 'whatsapp.send' : 'whatsapp.send-preview', target: req.kind === 'template' ? req.template!.name : 'text', at: new Date(), details: { people: contacts.length + unknown.length, sent: out.sent, failed: out.failed, skipped: out.skipped, batch } });
  return out;
}
