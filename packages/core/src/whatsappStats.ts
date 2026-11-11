import type { Collection } from 'mongodb';
import { getMetaFailureCopy } from './metaErrorCopy.js';
import type { WhatsAppMessageDoc } from './whatsapp.js';

/** Numbers for the WhatsApp Stats page: how many messages went out, arrived, were read, or failed, by day and by template, and why failures happened. */

export interface DayRow { day: string; sent: number; delivered: number; read: number; failed: number }
export interface TemplateRow { template: string; sent: number; delivered: number; read: number; failed: number }
export interface WaStats { days: number; sent: number; delivered: number; read: number; failed: number; replies: number; byDay: DayRow[]; byTemplate: TemplateRow[]; failures: { title: string; action: string; n: number }[] }

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
export const rate = pct;

/** `sent` counts every message we tried to send; delivered counts those delivered or read; read counts those read. */
export async function waStats(c: { whatsappMessages: Collection<WhatsAppMessageDoc> }, days = 14, now = new Date()): Promise<WaStats> {
  const d = Math.min(90, Math.max(1, Math.floor(days)));
  const since = new Date(now.getTime() - d * 86400_000);
  const match = { createdAt: { $gte: since } };
  const flags = { sent: { $literal: 1 }, delivered: { $cond: [{ $in: ['$status', ['delivered', 'read']] }, 1, 0] }, read: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] }, failed: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } };
  const sum = { sent: { $sum: '$sent' }, delivered: { $sum: '$delivered' }, read: { $sum: '$read' }, failed: { $sum: '$failed' } };
  const [days_, tpls, fails, inbound] = await Promise.all([
    c.whatsappMessages.aggregate<DayRow & { _id: string }>([{ $match: { ...match, direction: 'out' } }, { $project: { ...flags, day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } } } }, { $group: { _id: '$day', ...sum } }, { $sort: { _id: 1 } }]).toArray(),
    c.whatsappMessages.aggregate<TemplateRow & { _id: string }>([{ $match: { ...match, direction: 'out' } }, { $project: { ...flags, t: { $ifNull: ['$template', '(text reply)'] } } }, { $group: { _id: '$t', ...sum } }, { $sort: { sent: -1 } }, { $limit: 30 }]).toArray(),
    c.whatsappMessages.aggregate<{ _id: string; n: number }>([{ $match: { ...match, direction: 'out', status: 'failed' } }, { $group: { _id: { $ifNull: ['$errorText', ''] }, n: { $sum: 1 } } }]).toArray(),
    c.whatsappMessages.countDocuments({ ...match, direction: 'in' }),
  ]);
  const grouped = new Map<string, { title: string; action: string; n: number }>();
  for (const f of fails) { const copy = getMetaFailureCopy(f._id); const g = grouped.get(copy.title) ?? { title: copy.title, action: copy.action, n: 0 }; g.n += f.n; grouped.set(copy.title, g); }
  const tot = days_.reduce((t, r) => ({ sent: t.sent + r.sent, delivered: t.delivered + r.delivered, read: t.read + r.read, failed: t.failed + r.failed }), { sent: 0, delivered: 0, read: 0, failed: 0 });
  return { days: d, ...tot, replies: inbound, byDay: days_.map((r) => ({ day: r._id, sent: r.sent, delivered: r.delivered, read: r.read, failed: r.failed })), byTemplate: tpls.map((r) => ({ template: r._id, sent: r.sent, delivered: r.delivered, read: r.read, failed: r.failed })), failures: [...grouped.values()].sort((a, b) => b.n - a.n) };
}

export const RETENTION_DAYS = 365;
const STALE_MINUTES = 30;

/** Housekeeping for the hourly job: a message stuck "sending" for half an hour is closed as failed, and chat history older than a year is removed
 *  (reminder records are kept because they decide how many reminders an order has had). */
export async function tidyMessages(c: { whatsappMessages: Collection<WhatsAppMessageDoc> }, now = new Date()): Promise<{ closed: number; removed: number }> {
  const closed = await c.whatsappMessages.updateMany({ direction: 'out', status: 'queued', createdAt: { $lt: new Date(now.getTime() - STALE_MINUTES * 60_000) } }, { $set: { status: 'failed', errorText: 'Stale: no answer from WhatsApp', statusAt: now }, $unset: { sendKey: '' } });
  const removed = await c.whatsappMessages.deleteMany({ phone: { $exists: true }, kind: { $ne: 'reminder' }, createdAt: { $lt: new Date(now.getTime() - RETENTION_DAYS * 86400_000) } });
  return { closed: closed.modifiedCount, removed: removed.deletedCount };
}
