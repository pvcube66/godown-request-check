import { describe, expect, it } from 'vitest';
import { conversationFilter, touchConversation, windowEndsAt } from './whatsappConversations.js';

describe('chat list filters', () => {
  it('unread, open, closed', () => {
    expect(conversationFilter({ filter: 'unread' })).toEqual({ unread: { $gt: 0 } });
    expect(conversationFilter({ filter: 'closed' })).toEqual({ status: 'closed' });
    expect(conversationFilter({})).toEqual({});
  });
  it('"today" starts at midnight India time', () => {
    const f = conversationFilter({ filter: 'today' }, new Date('2026-11-11T20:00:00Z')) as { lastAt: { $gte: Date } };   // 01:30 on 12 Nov in India
    expect(f.lastAt.$gte.toISOString()).toBe('2026-11-11T18:30:00.000Z');
  });
  it('search is literal, and short digit strings do not search numbers', () => {
    const f = conversationFilter({ q: 'a.*(' }) as { $or: { contactName?: { $regex: string } }[] };
    expect(f.$or[0]!.contactName!.$regex).toBe('a\\.\\*\\(');
    expect(JSON.stringify(conversationFilter({ q: '12' }))).not.toContain('"phone"');
    expect(JSON.stringify(conversationFilter({ q: '+91 98765' }))).toContain('"phone":{"$regex":"9198765"}');
  });
});
describe('conversation bookkeeping', () => {
  it('does nothing without a chat table', async () => { await expect(touchConversation({}, '91', { direction: 'in', text: 'x', at: new Date() })).resolves.toBeUndefined(); });
  it('a reply counts unread and reopens; our message does not', async () => {
    const calls: any[] = [];
    const c = { waConversations: { updateOne: async (...a: unknown[]) => { calls.push(a); } } } as never;
    const t = new Date();
    await touchConversation(c, '919', { direction: 'in', text: 'hi', at: t, name: 'Meena' });
    await touchConversation(c, '919', { direction: 'out', text: 'yo', at: t });
    expect(calls[0][1].$inc).toEqual({ unread: 1 }); expect(calls[0][1].$set).toMatchObject({ status: 'open', lastInboundAt: t, contactName: 'Meena' });
    expect(calls[1][1].$inc).toBeUndefined(); expect(calls[1][1].$set.status).toBeUndefined(); expect(calls[1][1].$set.lastInboundAt).toBeUndefined();
  });
  it('the reply window ends 24 hours after their last message', () => {
    expect(windowEndsAt(new Date('2026-11-11T10:00:00Z'))!.toISOString()).toBe('2026-11-12T10:00:00.000Z');
    expect(windowEndsAt(null)).toBeNull();
  });
});
