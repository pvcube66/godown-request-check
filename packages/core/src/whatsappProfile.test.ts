import { describe, expect, it } from 'vitest';
import { sealSecret } from './secretBox.js';
import { DEFAULT_SETTINGS } from './whatsapp.js';
import { addQuickReply, deleteQuickReply, EMPTY_PROFILE, fetchBusinessProfile, saveBusinessProfile, validateProfile, type QuickReplyCollections } from './whatsappProfile.js';

process.env.CREDENTIAL_ENC_KEY ||= 'a'.repeat(64);
const s = { ...DEFAULT_SETTINGS(), phoneNumberId: '123456', wabaId: '654321', accessTokenEnc: sealSecret('tok') };
const ok = { ...EMPTY_PROFILE, about: 'Hostel supplies', websites: ['https://example.org'], email: 'a@b.co', vertical: 'GOVT' };

describe('profile checks', () => {
  it('accepts a good profile and trims it', () => expect(validateProfile({ ...ok, about: '  Hostel supplies ' }).about).toBe('Hostel supplies'));
  it.each([
    [{ about: 'x'.repeat(140) }, /139/], [{ description: 'x'.repeat(513) }, /512/], [{ address: 'x'.repeat(257) }, /256/], [{ email: 'nope' }, /email/],
    [{ websites: ['a.com'] }, /web address/], [{ websites: ['https://a.com', 'https://b.com', 'https://c.com'] }, /up to 2/], [{ websites: ['javascript:alert(1)'] }, /web address/], [{ vertical: 'EVIL' }, /type of business/],
  ])('refuses %j', (bad, re) => expect(() => validateProfile({ ...ok, ...bad })).toThrow(re));
});
describe('talking to Meta', () => {
  it('reads the profile', async () => {
    const f = (async () => ({ ok: true, status: 200, json: async () => ({ data: [{ about: 'Hi', websites: ['https://x.org'], vertical: 'EDU', profile_picture_url: 'https://p' }] }) })) as unknown as typeof fetch;
    expect(await fetchBusinessProfile(s, f)).toMatchObject({ about: 'Hi', websites: ['https://x.org'], vertical: 'EDU', description: '' });
  });
  it('saves with the right body and logs it; refuses bad input before the network', async () => {
    const calls: any[] = []; const audit: any[] = [];
    const f = (async (u: string, i: any) => { calls.push([u, JSON.parse(i.body)]); return { ok: true, status: 200, json: async () => ({ success: true }) }; }) as unknown as typeof fetch;
    const c = { auditLog: { insertOne: async (a: unknown) => { audit.push(a); } } } as never;
    await saveBusinessProfile(c, s, ok, 'u', f);
    expect(calls[0][0]).toContain('/123456/whatsapp_business_profile'); expect(calls[0][1]).toMatchObject({ messaging_product: 'whatsapp', about: 'Hostel supplies', vertical: 'GOVT' }); expect(audit).toHaveLength(1);
    await expect(saveBusinessProfile(c, s, { ...ok, email: 'x' }, 'u', f)).rejects.toThrow(); expect(calls).toHaveLength(1);
    await expect(fetchBusinessProfile({ ...s, accessTokenEnc: null })).rejects.toThrow(/Connect WhatsApp/);
  });
  it('explains a Meta refusal', async () => {
    const f = (async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 100, message: 'bad' } }) })) as unknown as typeof fetch;
    await expect(fetchBusinessProfile(s, f)).rejects.toThrow(/100/);
  });
});
describe('quick replies', () => {
  function fake() { const docs: any[] = []; const c = { waQuickReplies: { countDocuments: async () => docs.length, insertOne: async (d: any) => { if (docs.some((x) => x.title === d.title)) throw Object.assign(new Error('d'), { code: 11000 }); docs.push(d); }, deleteOne: async (f: any) => { const i = docs.findIndex((x) => x.title === f.title); if (i >= 0) docs.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; } }, auditLog: { insertOne: async () => {} } } as unknown as QuickReplyCollections; return { c, docs }; }
  it('adds, refuses duplicates, bad input and the 51st, and deletes', async () => {
    const { c, docs } = fake();
    await addQuickReply(c, ' Thanks ', ' Thank you! ', 'u'); expect(docs[0]).toMatchObject({ title: 'Thanks', text: 'Thank you!' });
    await expect(addQuickReply(c, 'Thanks', 'x', 'u')).rejects.toThrow(/already exists/);
    await expect(addQuickReply(c, '', 'x', 'u')).rejects.toThrow(/title/); await expect(addQuickReply(c, 'a', ' ', 'u')).rejects.toThrow(/Type the reply/); await expect(addQuickReply(c, 't'.repeat(31), 'x', 'u')).rejects.toThrow(/title/);
    for (let i = 0; i < 49; i++) docs.push({ title: `q${i}` });
    await expect(addQuickReply(c, 'one more', 'x', 'u')).rejects.toThrow(/up to 50/);
    await deleteQuickReply(c, 'Thanks', 'u'); await expect(deleteQuickReply(c, 'Thanks', 'u')).rejects.toThrow(/no longer exists/);
  });
});
