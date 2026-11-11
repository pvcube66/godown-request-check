import { describe, expect, it } from 'vitest';
import { sealSecret } from './secretBox.js';
import { DEFAULT_SETTINGS } from './whatsapp.js';
import { fillValue, MAX_DIRECT, MAX_PER_HOUR, resolveRecipients, sendMessages, templateSlots, windowOpen, type SendCollections } from './whatsappSend.js';

process.env.CREDENTIAL_ENC_KEY ||= 'a'.repeat(64);

type Doc = Record<string, any>;
function coll(docs: Doc[] = [], unique: string[] = []) {
  const m = (d: Doc, f: Doc): boolean => Object.entries(f).every(([k, v]) => v && typeof v === 'object' && !(v instanceof Date) && '$in' in v ? v.$in.includes(d[k]) : d[k] === v);
  return {
    docs,
    countDocuments: async () => docs.length,
    find: (f: Doc = {}) => ({ toArray: async () => docs.filter((d) => m(d, f)) }),
    findOne: async (f: Doc, o?: { sort?: Doc }) => { const r = docs.filter((d) => m(d, f)); if (o?.sort) r.sort((a, b) => b.createdAt - a.createdAt); return r[0] ?? null; },
    insertOne: async (d: Doc) => { for (const u of unique) if (d[u] !== undefined && docs.some((x) => x[u] === d[u])) throw Object.assign(new Error('dup'), { code: 11000 }); docs.push({ ...d }); },
    updateOne: async (f: Doc, u: Doc) => { const d = docs.find((x) => m(x, f)); if (d) { Object.assign(d, u.$set ?? {}); for (const k of Object.keys(u.$unset ?? {})) delete d[k]; } return { matchedCount: d ? 1 : 0 }; },
  };
}
const NOW = new Date('2026-11-11T10:00:00Z');
function setup(mode: 'live' | 'dry_run' | 'off' = 'live') {
  const settings = { ...DEFAULT_SETTINGS(), mode, phoneNumberId: '123456', wabaId: '654321', accessTokenEnc: sealSecret('tok') };
  const contacts = [
    { phone: '919876543210', name: 'Ravi Kumar', optedOut: false }, { phone: '919876543211', name: 'Sita', optedOut: false }, { phone: '919876543212', name: 'Gone', optedOut: true },
  ];
  const c = {
    settings: { findOne: async () => ({ value: settings }), updateOne: async () => ({}) }, auditLog: coll(), whatsappMessages: coll([], ['sendKey']), waContacts: coll(contacts), waGroups: coll([{ name: 'north', members: ['919876543211', '919876543212'] }]),
    waTemplates: coll([{ name: 'hello', language: 'en', status: 'APPROVED', bodyText: 'Hi {{1}}, your order {{2}} is ready.', form: null }, { name: 'draft', language: 'en', status: 'PENDING', bodyText: 'x', form: null }]),
  };
  return { c: c as unknown as SendCollections, raw: c };
}
const fakeFetch = (log: any[], fail?: (to: string) => { code: number; message: string } | null) => (async (_u: string, init: any) => {
  const body = JSON.parse(init.body); log.push(body); const f = fail?.(body.to);
  return f ? { ok: false, status: 400, json: async () => ({ error: f }) } : { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${log.length}` }] }) };
}) as unknown as typeof fetch;
const tpl = { kind: 'template' as const, template: { name: 'hello', language: 'en' }, body: ['{name}', 'A12'], phones: ['919876543210'] };

describe('helpers', () => {
  it('counts blanks and fills the first name', () => {
    expect(templateSlots({ bodyText: 'a {{1}} {{2}} {{1}}', form: null })).toEqual({ body: 2, header: 0 });
    expect(fillValue('Dear {name}\n\n ok', { name: 'Ravi Kumar' })).toBe('Dear Ravi ok');
    expect(fillValue('{NAME}', { name: '' })).toBe('there');
  });
  it('24-hour window', () => {
    expect(windowOpen(new Date(NOW.getTime() - 23 * 3600_000), NOW)).toBe(true);
    expect(windowOpen(new Date(NOW.getTime() - 25 * 3600_000), NOW)).toBe(false);
    expect(windowOpen(null, NOW)).toBe(false);
  });
  it('merges people and groups once', async () => {
    const { c } = setup();
    const r = await resolveRecipients(c, ['919876543211', '910000000000'], ['north']);
    expect(r.contacts.map((x) => x.phone).sort()).toEqual(['919876543211', '919876543212']); expect(r.unknown).toEqual(['910000000000']);
  });
});

describe('sending a template', () => {
  it('preview sends nothing and shows the filled text', async () => {
    const { c, raw } = setup(); const log: any[] = [];
    const r = await sendMessages(c, tpl, { preview: true, actor: 'u' }, fakeFetch(log), NOW);
    expect(log).toHaveLength(0); expect(raw.whatsappMessages.docs).toHaveLength(0);
    expect(r.preview).toBe(true); expect(r.results[0]).toMatchObject({ outcome: 'would_send', text: 'Hi Ravi, your order A12 is ready.' });
  });
  it('live sends with the right Meta payload, records it with the full number, and notes the sender', async () => {
    const { c, raw } = setup(); const log: any[] = [];
    const r = await sendMessages(c, { ...tpl, batchId: 'b1' }, { preview: false, actor: 'user:1' }, fakeFetch(log), NOW);
    expect(r.sent).toBe(1);
    expect(log[0]).toMatchObject({ to: '919876543210', type: 'template', template: { name: 'hello', components: [{ type: 'body', parameters: [{ text: 'Ravi' }, { text: 'A12' }] }] } });
    expect(raw.whatsappMessages.docs[0]).toMatchObject({ phone: '919876543210', status: 'sent', kind: 'single', sentBy: 'user:1', messageId: 'wamid.1' });
  });
  it('never messages an opted-out person, even inside a group', async () => {
    const { c } = setup(); const log: any[] = [];
    const r = await sendMessages(c, { ...tpl, phones: [], groups: ['north'] }, { preview: false, actor: 'u' }, fakeFetch(log), NOW);
    expect(log.map((b) => b.to)).toEqual(['919876543211']);
    expect(r.results.find((x) => x.phone === '919876543212')!.outcome).toBe('opted_out');
  });
  it('a double-click with the same batch id sends once', async () => {
    const { c } = setup(); const log: any[] = [];
    await sendMessages(c, { ...tpl, batchId: 'same' }, { preview: false, actor: 'u' }, fakeFetch(log), NOW);
    const again = await sendMessages(c, { ...tpl, batchId: 'same' }, { preview: false, actor: 'u' }, fakeFetch(log), NOW);
    expect(log).toHaveLength(1); expect(again.sent).toBe(0);
  });
  it('a failure is explained, the rest still go, and the failure can be retried', async () => {
    const { c, raw } = setup(); const log: any[] = [];
    const f = fakeFetch(log, (to) => (to === '919876543210' ? { code: 131026, message: 'Message undeliverable' } : null));
    const r = await sendMessages(c, { ...tpl, phones: ['919876543210', '919876543211'], batchId: 'b' }, { preview: false, actor: 'u' }, f, NOW);
    expect([r.sent, r.failed]).toEqual([1, 1]); expect(r.results[0]!.note).toBeTruthy();
    expect(raw.whatsappMessages.docs.find((d) => d.phone === '919876543210')!.sendKey).toBeUndefined();
  });
  it('an account-level error stops the rest', async () => {
    const { c } = setup(); const log: any[] = [];
    const r = await sendMessages(c, { ...tpl, phones: ['919876543210', '919876543211'] }, { preview: false, actor: 'u' }, fakeFetch(log, () => ({ code: 190, message: 'token expired' })), NOW);
    expect(log).toHaveLength(1); expect(r.stopped).toBeTruthy(); expect(r.results[1]!.outcome).toBe('failed');
  });
  it('refuses live sending in preview mode or when off, but still previews', async () => {
    for (const mode of ['dry_run', 'off'] as const) {
      const { c } = setup(mode); const log: any[] = [];
      await expect(sendMessages(c, tpl, { preview: false, actor: 'u' }, fakeFetch(log), NOW)).rejects.toThrow(/preview mode|turned off/);
      expect(log).toHaveLength(0);
    }
    expect((await sendMessages(setup('dry_run').c, tpl, { preview: true, actor: 'u' }, fakeFetch([]), NOW)).results).toHaveLength(1);
  });
  it('rejects bad requests before any network call', async () => {
    const { c } = setup(); const log: any[] = [];
    const go = (r: object) => sendMessages(c, { ...tpl, ...r } as never, { preview: false, actor: 'u' }, fakeFetch(log), NOW);
    await expect(go({ template: { name: 'draft', language: 'en' }, body: ['x'] })).rejects.toThrow(/approved/);
    await expect(go({ template: { name: 'nope', language: 'en' } })).rejects.toThrow(/not saved/);
    await expect(go({ body: ['only one'] })).rejects.toThrow(/Fill in all 2/);
    await expect(go({ body: ['', 'x'] })).rejects.toThrow(/Fill in all 2/);
    await expect(go({ phones: [] })).rejects.toThrow(/at least one/);
    await expect(go({ phones: Array.from({ length: MAX_DIRECT + 1 }, (_, i) => `9190000000${i}`) })).rejects.toThrow(/campaign/);
    expect(log).toHaveLength(0);
  });
  it('numbers that are not in People are skipped, not messaged', async () => {
    const { c } = setup(); const log: any[] = [];
    const r = await sendMessages(c, { ...tpl, phones: ['919000000000'] }, { preview: false, actor: 'u' }, fakeFetch(log), NOW);
    expect(log).toHaveLength(0); expect(r.results[0]!.outcome).toBe('not_saved');
  });
});

describe('hourly limit', () => {
  it('refuses a send that would pass the limit, before any network call', async () => {
    const { c, raw } = setup(); const log: any[] = [];
    for (let i = 0; i < MAX_PER_HOUR; i++) raw.whatsappMessages.docs.push({ direction: 'out', kind: 'single', createdAt: NOW });
    await expect(sendMessages(c, tpl, { preview: false, actor: 'u' }, fakeFetch(log), NOW)).rejects.toThrow(/an hour/);
    expect(log).toHaveLength(0);
    expect((await sendMessages(c, tpl, { preview: true, actor: 'u' }, fakeFetch(log), NOW)).preview).toBe(true);   // previewing is always allowed
  });
});

describe('sending text', () => {
  const text = { kind: 'text' as const, text: 'Thanks, noted', phones: ['919876543210'] };
  it('only inside 24 hours of their last message', async () => {
    const { c, raw } = setup(); const log: any[] = [];
    expect((await sendMessages(c, text, { preview: false, actor: 'u' }, fakeFetch(log), NOW)).results[0]!.outcome).toBe('outside_window');
    raw.whatsappMessages.docs.push({ direction: 'in', phone: '919876543210', createdAt: new Date(NOW.getTime() - 3600_000) });
    const r = await sendMessages(c, text, { preview: false, actor: 'u' }, fakeFetch(log), NOW);
    expect(r.sent).toBe(1); expect(log[0]).toMatchObject({ type: 'text', text: { body: 'Thanks, noted' } });
  });
});
