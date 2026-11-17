import { daysBetween, daysInStage, istDay } from './orders.js';
import { hostelLabel } from './hostelName.js';
import { getMetaFailureCopy } from './metaErrorCopy.js';
import { sendTemplateMessage, WhatsAppApiError, type Fetcher } from './whatsappApi.js';
import { touchConversation } from './whatsappConversations.js';
import { credentialsOf, getWhatsAppSettings, noteWhatsAppError, renderTemplate, templateValues, whatsappNumber, type WhatsAppCollections, type WhatsAppSettings } from './whatsapp.js';

/** "Delivery not acknowledged" reminders (decision D9): an order is In-Transit and still not acknowledged after N days -> WhatsApp the hostel,
 *  then again every M days, up to K messages, one per hostel per day, and stop the moment the order is Acknowledged, Rejected or Cancelled.
 *  In preview mode (dry run) this only works out who would be messaged. */

export type SkipReason = 'too_early' | 'waiting_between' | 'max_reached' | 'no_phone' | 'opted_out' | 'hostel_cap';
export const SKIP_TEXT: Record<SkipReason, string> = {
  too_early: 'Not in transit long enough yet', waiting_between: 'Waiting for the gap after the last reminder', max_reached: 'All reminders already sent',
  no_phone: 'No usable phone number for this hostel', opted_out: 'The hostel asked us to stop', hostel_cap: 'Already messaged this hostel today',
};

export interface ReminderCandidate {
  requestId: string; hostelCode: string; hostelName: string; districtName: string;
  daysInTransit: number; dispatchedOn: Date;
  phone: string | null; optedOut: boolean;
  /** Reminders already counted for this order, oldest first. */
  sentAt: Date[];
  /** A reminder already went to this hostel today (any order). */
  hostelMessagedToday: boolean;
}
export type Rules = Pick<WhatsAppSettings, 'firstAfterDays' | 'everyDays' | 'maxMessages'>;
export type Decision = { send: true; reminderNo: number } | { send: false; reason: SkipReason };


/** Whether one order gets a reminder now, and which number it is. Pure. */
export function decide(c: ReminderCandidate, rules: Rules, now: Date): Decision {
  const n = c.sentAt.length;
  if (c.optedOut) return { send: false, reason: 'opted_out' };
  if (rules.maxMessages > 0 && n >= rules.maxMessages) return { send: false, reason: 'max_reached' };
  if (n === 0 ? c.daysInTransit < rules.firstAfterDays : daysBetween(c.sentAt[n - 1]!, now) < rules.everyDays) return { send: false, reason: n === 0 ? 'too_early' : 'waiting_between' };
  if (!c.phone) return { send: false, reason: 'no_phone' };
  if (c.hostelMessagedToday) return { send: false, reason: 'hostel_cap' };
  return { send: true, reminderNo: n + 1 };
}

export interface PlanItem { requestId: string; hostelCode: string; hostelName: string; districtName: string; phone: string; reminderNo: number; values: string[]; text: string }
export interface Plan { items: PlanItem[]; skipped: { requestId: string; hostelName: string; reason: SkipReason }[]; transit: number }

/** Works out who would be messaged right now. Reads only; sends nothing. At most one order per hostel (the longest waiting). */
export async function planReminders(c: WhatsAppCollections, settings: WhatsAppSettings, now = new Date()): Promise<Plan> {
  const orders = await c.orders.find({ stage: 'transit' }).sort({ stageSince: 1 }).toArray();
  const out: Plan = { items: [], skipped: [], transit: orders.length };
  if (!orders.length) return out;

  const accounts = [...new Set(orders.map((o) => o.account))];
  const gods = await c.godowns.find({ portalLogin: { $in: accounts } }, { projection: { godownId: 1, portalLogin: 1 } }).toArray();
  const godownsOf = new Map<string, number[]>();
  for (const g of gods) godownsOf.set(g.portalLogin, [...(godownsOf.get(g.portalLogin) ?? []), g.godownId]);
  const hostels = await c.hostelsMaster.find({ hostelCode: { $in: [...new Set(orders.map((o) => o.hostelCode))] } }, { projection: { godownId: 1, hostelCode: 1, hostelPhone: 1, whatsappOptOut: 1 } }).toArray();
  const hostelOf = (account: string, code: string) => hostels.find((h) => h.hostelCode === code && (godownsOf.get(account) ?? []).includes(h.godownId)) ?? hostels.find((h) => h.hostelCode === code);

  const dayStart = new Date(`${istDay(now)}T00:00:00+05:30`);
  const history = await c.whatsappMessages.find({ direction: 'out', counted: true, $or: [{ requestId: { $in: orders.map((o) => o.requestId) } }, { createdAt: { $gte: dayStart } }] }, { projection: { requestId: 1, hostelCode: 1, createdAt: 1 } }).sort({ createdAt: 1 }).toArray();
  const messagedToday = new Set(history.filter((m) => m.createdAt >= dayStart).map((m) => m.hostelCode));
  const sentFor = new Map<string, Date[]>();
  for (const m of history) if (m.requestId) sentFor.set(m.requestId, [...(sentFor.get(m.requestId) ?? []), m.createdAt]);

  for (const o of orders) {                                   // oldest wait first, so the longest-waiting order of a hostel is the one reminded
    const h = hostelOf(o.account, o.hostelCode);
    const cand: ReminderCandidate = {
      requestId: o.requestId, hostelCode: o.hostelCode, hostelName: o.hostelName, districtName: o.districtName,
      daysInTransit: daysInStage(o, now), dispatchedOn: o.reached?.transit ?? o.reached?.dc ?? o.stageSince,
      phone: whatsappNumber(h?.hostelPhone), optedOut: h?.whatsappOptOut === true, sentAt: sentFor.get(o.requestId) ?? [], hostelMessagedToday: messagedToday.has(o.hostelCode),
    };
    const d = decide(cand, settings, now);
    if (!d.send) { out.skipped.push({ requestId: o.requestId, hostelName: o.hostelName, reason: d.reason }); continue; }
    messagedToday.add(o.hostelCode);                          // one message per hostel per day
    const values = templateValues({ hostelName: o.hostelName, requestId: o.requestId, dispatchedOn: cand.dispatchedOn }, d.reminderNo, hostelLabel);
    out.items.push({ requestId: o.requestId, hostelCode: o.hostelCode, hostelName: o.hostelName, districtName: o.districtName, phone: cand.phone!, reminderNo: d.reminderNo, values, text: renderTemplate(values) });
  }
  return out;
}

/** Problems that affect every message, so the run stops instead of failing once per hostel. */
export const ACCOUNT_LEVEL = new Set(['190', '132001', '131042', '133010', '131031', '80007', '131048', '131056', '131020', '131041', '131059', '100']);

let running = false;
export interface ReminderRun { mode: WhatsAppSettings['mode']; planned: number; sent: number; refused: number; skipped: number; stopped: string | null }

/** The hourly step. Off: nothing. Preview: counts only. Live: sends, recording every message and its result. */
export async function runReminders(c: WhatsAppCollections, now = new Date(), fetcher?: Fetcher): Promise<ReminderRun> {
  const s = await getWhatsAppSettings(c);
  const run: ReminderRun = { mode: s.mode, planned: 0, sent: 0, refused: 0, skipped: 0, stopped: null };
  if (s.mode === 'off' || running) return run;
  running = true;
  try {
    const plan = await planReminders(c, s, now);
    run.planned = plan.items.length; run.skipped = plan.skipped.length;
    if (s.mode !== 'live' || !plan.items.length) return run;

    const cred = credentialsOf(s);
    if (!cred || s.templateStatus !== 'APPROVED') { run.stopped = 'WhatsApp is set to live but the setup or the template approval is incomplete.'; await noteWhatsAppError(c, run.stopped); return run; }

    // A message that was queued but never got an answer is closed as "stale" so it cannot block the next reminder forever.
    await c.whatsappMessages.updateMany({ direction: 'out', status: 'queued', createdAt: { $lt: new Date(now.getTime() - 30 * 60_000) } }, { $set: { status: 'failed', errorText: 'Stale: no answer from WhatsApp', statusAt: now } });

    for (const item of plan.items) {
      const sendKey = `${item.requestId}|${item.reminderNo}`;
      try {
        await c.whatsappMessages.insertOne({ sendKey, messageId: null, direction: 'out', requestId: item.requestId, hostelCode: item.hostelCode, hostelName: item.hostelName, districtName: item.districtName, phone: item.phone, phoneLast4: item.phone.slice(-4), kind: 'reminder', template: s.templateName, reminderNo: item.reminderNo, text: item.text, status: 'queued', counted: true, createdAt: now, statusAt: now });
      } catch (e) { if ((e as { code?: number }).code === 11000) continue; throw e; }      // another run already took this reminder
      try {
        const id = await sendTemplateMessage(cred, item.phone, { name: s.templateName, language: s.language }, item.values, fetcher);
        await c.whatsappMessages.updateOne({ sendKey }, { $set: { messageId: id, status: 'sent', statusAt: new Date() } });
        await touchConversation(c, item.phone, { direction: 'out', text: item.text, at: new Date(), name: item.hostelName });
        run.sent++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = e instanceof WhatsAppApiError ? e.code : '';
        // Meta refused it: free the slot so the reminder is tried again, and say why in plain words.
        await c.whatsappMessages.updateOne({ sendKey }, { $set: { status: 'failed', counted: false, errorText: msg.slice(0, 300), errorCode: code, statusAt: new Date() }, $unset: { sendKey: '' } });
        run.refused++;
        if (ACCOUNT_LEVEL.has(code) || !(e instanceof WhatsAppApiError)) { run.stopped = getMetaFailureCopy(msg).title; await noteWhatsAppError(c, `${getMetaFailureCopy(msg).title}. ${getMetaFailureCopy(msg).action}`); break; }
      }
    }
    if (!run.stopped && run.sent > 0) await noteWhatsAppError(c, null);
    return run;
  } finally { running = false; }
}
