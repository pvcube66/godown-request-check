import type { Collection } from 'mongodb';
import type { WhatsAppMessageDoc } from './whatsapp.js';

/** Chats: one conversation per phone number, kept up to date as messages go out and replies come in. */

export interface ConversationDoc {
  phone: string;                         // unique
  contactName: string;
  lastText: string; lastAt: Date; lastDirection: 'in' | 'out';
  lastInboundAt: Date | null;            // the 24-hour reply window starts here
  unread: number;
  status: 'open' | 'closed';
  createdAt: Date;
}
type ConvC = { waConversations?: Collection<ConversationDoc> };

/** Records a message on the conversation. A reply from the person reopens a closed chat and counts as unread. Safe to call with no chat table (older setups). */
export async function touchConversation(c: ConvC, phone: string, m: { direction: 'in' | 'out'; text: string; at: Date; name?: string }): Promise<void> {
  if (!c.waConversations) return;
  const inbound = m.direction === 'in';
  await c.waConversations.updateOne({ phone }, {
    $set: { lastText: m.text.slice(0, 200), lastAt: m.at, lastDirection: m.direction, ...(inbound ? { lastInboundAt: m.at, status: 'open' as const } : {}), ...(m.name ? { contactName: m.name } : {}) },
    ...(inbound ? { $inc: { unread: 1 } } : {}),
    $setOnInsert: { phone, createdAt: m.at, ...(inbound ? {} : { unread: 0, status: 'open' as const, lastInboundAt: null }), ...(m.name ? {} : { contactName: '' }) },
  } as never, { upsert: true });
}

export type ChatFilter = 'all' | 'unread' | 'open' | 'closed' | 'today';
export const CHAT_FILTERS: [ChatFilter, string][] = [['all', 'All'], ['unread', 'Unread'], ['open', 'Open'], ['closed', 'Closed'], ['today', 'Today']];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The database filter for the chat list. Search text is matched literally. */
export function conversationFilter(o: { q?: string; filter?: string }, now = new Date()): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  if (o.filter === 'unread') f.unread = { $gt: 0 };
  else if (o.filter === 'open' || o.filter === 'closed') f.status = o.filter;
  else if (o.filter === 'today') { const d = new Date(now.getTime() + 5.5 * 3600_000); d.setUTCHours(0, 0, 0, 0); f.lastAt = { $gte: new Date(d.getTime() - 5.5 * 3600_000) }; }
  const q = (o.q ?? '').trim().slice(0, 60);
  if (q) { const digits = q.replace(/\D/g, ''); f.$or = [{ contactName: { $regex: escapeRe(q), $options: 'i' } }, { lastText: { $regex: escapeRe(q), $options: 'i' } }, ...(digits.length >= 3 ? [{ phone: { $regex: digits } }] : [])]; }
  return f;
}

export async function markRead(c: { waConversations: Collection<ConversationDoc> }, phone: string): Promise<void> {
  await c.waConversations.updateOne({ phone, unread: { $gt: 0 } }, { $set: { unread: 0 } });
}
export async function setConversationStatus(c: { waConversations: Collection<ConversationDoc> }, phone: string, status: 'open' | 'closed'): Promise<boolean> {
  return (await c.waConversations.updateOne({ phone }, { $set: { status } })).matchedCount === 1;
}
export const windowEndsAt = (lastInboundAt: Date | null) => (lastInboundAt ? new Date(lastInboundAt.getTime() + 24 * 3600_000) : null);
export type ThreadMessage = Pick<WhatsAppMessageDoc, 'direction' | 'text' | 'status' | 'errorText' | 'createdAt' | 'kind' | 'sentBy' | 'template'>;
