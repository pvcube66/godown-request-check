import { randomUUID } from 'node:crypto';
import type { Collection } from 'mongodb';
import { getMetaFailureCopy } from './metaErrorCopy.js';
import { ACCOUNT_LEVEL } from './reminders.js';
import { credentialsOf, getWhatsAppSettings, noteWhatsAppError, WhatsAppInputError, type WhatsAppCollections } from './whatsapp.js';
import { sendTemplateMessage, WhatsAppApiError, type Fetcher } from './whatsappApi.js';
import type { ContactDoc, GroupDoc } from './whatsappContacts.js';
import type { ConversationDoc } from './whatsappConversations.js';
import { touchConversation } from './whatsappConversations.js';
import { fillValue, templateSlots } from './whatsappSend.js';
import type { WaTemplateDoc } from './whatsappTemplates.js';
import { previewText } from './whatsappTemplateRules.js';

/** Campaigns: one approved message to a chosen audience, sent in small batches. Preview mode runs the whole flow and sends nothing.
 *  People who opted out are never messaged, even if they opt out after the campaign was made. */

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'done' | 'cancelled';
export interface Audience { all?: boolean; tags?: string[]; groups?: string[] }
export interface CampaignDoc {
  campaignId: string; name: string;
  template: { name: string; language: string }; body: string[]; header: string[];
  audience: Audience; status: CampaignStatus;
  dryRun: boolean;                         // true when it was run in preview mode: nothing was sent
  total: number; skippedOptOut: number;
  createdBy: string; createdAt: Date; updatedAt: Date; startedAt: Date | null; finishedAt: Date | null;
  lockUntil: Date | null; lastError: string | null;
}
export type RecipientStatus = 'queued' | 'sent' | 'failed' | 'previewed' | 'cancelled';
export interface RecipientDoc { campaignId: string; phone: string; name: string; status: RecipientStatus; messageId: string | null; error: string; updatedAt: Date }
export interface CampaignCollections extends WhatsAppCollections {
  waContacts: Collection<ContactDoc>; waGroups: Collection<GroupDoc>; waTemplates: Collection<WaTemplateDoc>; waConversations?: Collection<ConversationDoc>;
  waCampaigns: Collection<CampaignDoc>; waCampaignRecipients: Collection<RecipientDoc>;
}

export const BATCH_SIZE = 20;
export const DAILY_CAP = 1000;               // campaign messages per day (India time)
export const MAX_AUDIENCE = 5000;
export const STATUS_LABEL: Record<CampaignStatus, string> = { draft: 'Not started', running: 'Sending', paused: 'Paused', done: 'Finished', cancelled: 'Cancelled' };

const istMidnight = (now: Date) => { const d = new Date(now.getTime() + 5.5 * 3600_000); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - 5.5 * 3600_000); };

/** Everyone the audience points to (opted-out included, so they can be counted). */
export async function audienceContacts(c: Pick<CampaignCollections, 'waContacts' | 'waGroups'>, a: Audience): Promise<ContactDoc[]> {
  if (a.all) return c.waContacts.find({}).limit(MAX_AUDIENCE + 1).toArray();
  const phones = new Set<string>();
  if (a.groups?.length) for (const g of await c.waGroups.find({ name: { $in: a.groups } }).toArray()) for (const m of g.members) phones.add(m);
  const or: Record<string, unknown>[] = [];
  if (a.tags?.length) or.push({ tags: { $in: a.tags } });
  if (phones.size) or.push({ phone: { $in: [...phones] } });
  return or.length ? c.waContacts.find({ $or: or }).limit(MAX_AUDIENCE + 1).toArray() : [];
}

export interface CampaignInput { name: string; template: { name: string; language: string }; body: string[]; header: string[]; audience: Audience }

async function checkInput(c: CampaignCollections, i: CampaignInput) {
  const name = i.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 100) throw new WhatsAppInputError('Give the campaign a name (2 to 100 letters).');
  const tpl = await c.waTemplates.findOne({ name: i.template.name, language: i.template.language });
  if (!tpl) throw new WhatsAppInputError('That template is not saved here. Refresh the templates list.');
  if (tpl.status !== 'APPROVED') throw new WhatsAppInputError('Only approved templates can be sent.');
  const slots = templateSlots(tpl);
  if (i.body.length !== slots.body || i.body.some((v) => !v.trim())) throw new WhatsAppInputError(`Fill in all ${slots.body} blank${slots.body === 1 ? '' : 's'} of the message.`);
  if (i.header.length !== slots.header || i.header.some((v) => !v.trim())) throw new WhatsAppInputError('Fill in the heading blank.');
  if (!i.audience.all && !i.audience.tags?.length && !i.audience.groups?.length) throw new WhatsAppInputError('Choose who receives it: everyone, a tag, or a group.');
  const contacts = await audienceContacts(c, i.audience);
  if (contacts.length > MAX_AUDIENCE) throw new WhatsAppInputError(`A campaign can have up to ${MAX_AUDIENCE} people. Narrow the audience.`);
  return { name, tpl, contacts };
}

/** What a campaign would do, without saving anything. */
export async function reviewCampaign(c: CampaignCollections, i: CampaignInput): Promise<{ people: number; optedOut: number; will: number; sample: string }> {
  const { tpl, contacts } = await checkInput(c, i);
  const will = contacts.filter((x) => !x.optedOut);
  return { people: contacts.length, optedOut: contacts.length - will.length, will: will.length, sample: previewText(tpl.bodyText, i.body.map((v) => fillValue(v, will[0] ?? { name: '' }))) };
}

export async function createCampaign(c: CampaignCollections, i: CampaignInput, actor: string, now = new Date()): Promise<CampaignDoc> {
  const { name, contacts } = await checkInput(c, i);
  const will = contacts.filter((x) => !x.optedOut);
  if (!will.length) throw new WhatsAppInputError('No one in that audience can be messaged (they are opted out or the audience is empty).');
  const doc: CampaignDoc = { campaignId: randomUUID(), name, template: i.template, body: i.body.map((v) => v.trim()), header: i.header.map((v) => v.trim()), audience: i.audience, status: 'draft', dryRun: false, total: will.length, skippedOptOut: contacts.length - will.length, createdBy: actor, createdAt: now, updatedAt: now, startedAt: null, finishedAt: null, lockUntil: null, lastError: null };
  await c.waCampaigns.insertOne({ ...doc });
  await c.waCampaignRecipients.insertMany(will.map((x) => ({ campaignId: doc.campaignId, phone: x.phone, name: x.name, status: 'queued' as const, messageId: null, error: '', updatedAt: now })));
  await c.auditLog.insertOne({ actor, action: 'campaign.create', target: doc.campaignId, at: now, details: { name, people: will.length, optedOut: doc.skippedOptOut } });
  return doc;
}

const FROM: Record<'start' | 'pause' | 'resume' | 'cancel', CampaignStatus[]> = { start: ['draft'], pause: ['running'], resume: ['paused'], cancel: ['draft', 'running', 'paused'] };
const TO: Record<keyof typeof FROM, CampaignStatus> = { start: 'running', pause: 'paused', resume: 'running', cancel: 'cancelled' };

/** Moves a campaign along. Starting needs WhatsApp to be on (live or preview). Cancelling stops everyone still waiting. */
export async function changeCampaign(c: CampaignCollections, id: string, action: keyof typeof FROM, actor: string, now = new Date()): Promise<CampaignStatus> {
  if (action === 'start' || action === 'resume') {
    const s = await getWhatsAppSettings(c);
    if (s.mode === 'off') throw new WhatsAppInputError('WhatsApp is turned off. Turn it on in Settings first.');
    if (s.mode === 'live' && !credentialsOf(s)) throw new WhatsAppInputError('Connect WhatsApp first.');
  }
  const set: Partial<CampaignDoc> = { status: TO[action], updatedAt: now, lastError: null, ...(action === 'start' ? { startedAt: now, dryRun: (await getWhatsAppSettings(c)).mode !== 'live' } : {}), ...(action === 'cancel' ? { finishedAt: now } : {}) };
  const r = await c.waCampaigns.updateOne({ campaignId: id, status: { $in: FROM[action] } }, { $set: set });
  if (r.matchedCount !== 1) throw new WhatsAppInputError(`That campaign cannot be ${action === 'start' ? 'started' : action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : 'cancelled'} in its current state.`);
  if (action === 'cancel') await c.waCampaignRecipients.updateMany({ campaignId: id, status: 'queued' }, { $set: { status: 'cancelled', updatedAt: now } });
  await c.auditLog.insertOne({ actor, action: `campaign.${action}`, target: id, at: now });
  return TO[action];
}

/** Puts failed people back in the queue. A finished campaign starts running again. */
export async function retryFailed(c: CampaignCollections, id: string, actor: string, now = new Date()): Promise<number> {
  const camp = await c.waCampaigns.findOne({ campaignId: id });
  if (!camp) throw new WhatsAppInputError('That campaign no longer exists.');
  if (camp.status === 'cancelled' || camp.status === 'draft') throw new WhatsAppInputError('Start the campaign first.');
  const r = await c.waCampaignRecipients.updateMany({ campaignId: id, status: 'failed' }, { $set: { status: 'queued', error: '', updatedAt: now } });
  if (r.modifiedCount && camp.status === 'done') await c.waCampaigns.updateOne({ campaignId: id }, { $set: { status: 'running', finishedAt: null, updatedAt: now } });
  await c.auditLog.insertOne({ actor, action: 'campaign.retry', target: id, at: now, details: { people: r.modifiedCount } });
  return r.modifiedCount;
}

export interface CampaignStats { total: number; queued: number; sent: number; failed: number; delivered: number; read: number; previewed: number; cancelled: number }
export async function campaignStats(c: Pick<CampaignCollections, 'waCampaignRecipients' | 'whatsappMessages'>, id: string): Promise<CampaignStats> {
  const [rec, msg] = await Promise.all([
    c.waCampaignRecipients.aggregate<{ _id: RecipientStatus; n: number }>([{ $match: { campaignId: id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
    c.whatsappMessages.aggregate<{ _id: string; n: number }>([{ $match: { campaignId: id, direction: 'out', messageId: { $type: 'string' } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
  ]);
  const r = (k: RecipientStatus) => rec.find((x) => x._id === k)?.n ?? 0, m = (k: string) => msg.find((x) => x._id === k)?.n ?? 0;
  const total = rec.reduce((t, x) => t + x.n, 0);
  // "sent" = WhatsApp accepted it. Delivered, read and later failures are about those accepted messages.
  return { total, queued: r('queued'), sent: r('sent'), failed: r('failed') + m('failed'), delivered: m('delivered') + m('read'), read: m('read'), previewed: r('previewed'), cancelled: r('cancelled') };
}

export interface BatchResult { processed: number; state: 'done' | 'running' | 'paused' | 'waiting' | 'busy' | 'idle'; note?: string }

/** Sends the next small batch of a running campaign. Safe to call from two places at once: only one gets the lock. */
export async function runCampaignBatch(c: CampaignCollections, id: string, fetcher?: Fetcher, now = new Date()): Promise<BatchResult> {
  const camp = await c.waCampaigns.findOneAndUpdate({ campaignId: id, status: 'running', $or: [{ lockUntil: null }, { lockUntil: { $lt: now } }] }, { $set: { lockUntil: new Date(now.getTime() + 60_000) } }, { returnDocument: 'after' });
  if (!camp) { const cur = await c.waCampaigns.findOne({ campaignId: id }); return { processed: 0, state: !cur ? 'idle' : cur.status === 'running' ? 'busy' : cur.status === 'paused' ? 'paused' : cur.status === 'done' ? 'done' : 'idle' }; }
  let processed = 0, state: BatchResult['state'] = 'running', note: string | undefined;
  const pause = async (why: string) => { await c.waCampaigns.updateOne({ campaignId: id }, { $set: { status: 'paused', lastError: why, updatedAt: new Date() } }); state = 'paused'; note = why; };
  try {
    const s = await getWhatsAppSettings(c);
    const live = s.mode === 'live';
    if (s.mode === 'off') { await pause('WhatsApp is turned off.'); return { processed, state, note }; }
    const cred = credentialsOf(s);
    if (live) {
      const tpl = await c.waTemplates.findOne({ name: camp.template.name, language: camp.template.language });
      if (!cred || tpl?.status !== 'APPROVED') { await pause('The template is no longer approved, or WhatsApp is not connected.'); return { processed, state, note }; }
    }
    let room = BATCH_SIZE;
    if (live) {
      const today = await c.whatsappMessages.countDocuments({ kind: 'campaign', direction: 'out', createdAt: { $gte: istMidnight(now) } });
      room = Math.min(BATCH_SIZE, DAILY_CAP - today);
      if (room <= 0) return { processed, state: 'waiting', note: `Today’s limit of ${DAILY_CAP} campaign messages is reached. Sending continues tomorrow.` };
    }
    const queue = await c.waCampaignRecipients.find({ campaignId: id, status: 'queued' }).sort({ _id: 1 }).limit(room).toArray();
    for (const r of queue) {
      const cur = await c.waCampaigns.findOne({ campaignId: id }, { projection: { status: 1 } });
      if (cur?.status !== 'running') { state = cur?.status === 'paused' ? 'paused' : 'idle'; break; }
      const person = await c.waContacts.findOne({ phone: r.phone });
      if (!person || person.optedOut) { await c.waCampaignRecipients.updateOne({ campaignId: id, phone: r.phone }, { $set: { status: 'cancelled', error: 'Opted out', updatedAt: new Date() } }); await c.waCampaigns.updateOne({ campaignId: id }, { $inc: { skippedOptOut: 1, total: -1 } }); continue; }
      const values = camp.body.map((v) => fillValue(v, person)), head = camp.header.map((v) => fillValue(v, person));
      const tpl = await c.waTemplates.findOne({ name: camp.template.name, language: camp.template.language });
      const text = previewText(tpl?.bodyText ?? '', values);
      if (!live) { await c.waCampaignRecipients.updateOne({ campaignId: id, phone: r.phone }, { $set: { status: 'previewed', updatedAt: new Date() } }); processed++; continue; }
      const sendKey = `${id}|${r.phone}`;
      try {
        await c.whatsappMessages.insertOne({ sendKey, messageId: null, direction: 'out', requestId: null, hostelCode: '', hostelName: person.name, districtName: '', phone: r.phone, phoneLast4: r.phone.slice(-4), kind: 'campaign', campaignId: id, sentBy: camp.createdBy, template: camp.template.name, text, status: 'queued', counted: false, createdAt: new Date(), statusAt: new Date() });
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        const prev = await c.whatsappMessages.findOne({ sendKey });
        await c.waCampaignRecipients.updateOne({ campaignId: id, phone: r.phone }, { $set: prev?.messageId ? { status: 'sent', messageId: prev.messageId, updatedAt: new Date() } : { status: 'failed', error: 'Unknown result. Check this person in Chats before retrying.', updatedAt: new Date() } });
        continue;
      }
      try {
        const mid = await sendTemplateMessage(cred!, r.phone, { ...camp.template, headerParams: head }, values, fetcher);
        await c.whatsappMessages.updateOne({ sendKey }, { $set: { messageId: mid, status: 'sent', statusAt: new Date() } });
        await c.waCampaignRecipients.updateOne({ campaignId: id, phone: r.phone }, { $set: { status: 'sent', messageId: mid, updatedAt: new Date() } });
        await c.waContacts.updateOne({ phone: r.phone }, { $set: { lastMessagedAt: new Date() } });
        await touchConversation(c, r.phone, { direction: 'out', text, at: new Date(), name: person.name });
        processed++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = e instanceof WhatsAppApiError ? e.code : '';
        const copy = getMetaFailureCopy(msg);
        await c.whatsappMessages.updateOne({ sendKey }, { $set: { status: 'failed', errorText: msg.slice(0, 300), errorCode: code, statusAt: new Date() }, $unset: { sendKey: '' } });
        await c.waCampaignRecipients.updateOne({ campaignId: id, phone: r.phone }, { $set: { status: 'failed', error: `${copy.title}. ${copy.action}`.slice(0, 300), updatedAt: new Date() } });
        processed++;
        if (ACCOUNT_LEVEL.has(code) || !(e instanceof WhatsAppApiError)) { await noteWhatsAppError(c, `${copy.title}. ${copy.action}`); await pause(`${copy.title}. ${copy.action}`); break; }
      }
    }
    if (state === 'running' && (await c.waCampaignRecipients.countDocuments({ campaignId: id, status: 'queued' })) === 0) {
      await c.waCampaigns.updateOne({ campaignId: id, status: 'running' }, { $set: { status: 'done', finishedAt: new Date(), updatedAt: new Date() } }); state = 'done';
    }
    return { processed, state, note };
  } finally { await c.waCampaigns.updateOne({ campaignId: id }, { $set: { lockUntil: null } }); }
}

/** The hourly job's share: keeps every running campaign moving, a few batches each. */
export async function runCampaigns(c: CampaignCollections, fetcher?: Fetcher, now = new Date()): Promise<{ campaigns: number; processed: number }> {
  const running = await c.waCampaigns.find({ status: 'running' }, { projection: { campaignId: 1 } }).toArray();
  let processed = 0;
  for (const k of running) for (let i = 0; i < 5; i++) { const r = await runCampaignBatch(c, k.campaignId, fetcher, now); processed += r.processed; if (r.state !== 'running') break; }
  return { campaigns: running.length, processed };
}
