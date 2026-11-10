import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { getMetaFailureCopy, parseMetaCode } from './metaErrorCopy.js';
import { createTemplate, GRAPH_URL, getTemplateStatus, sendTemplateMessage, WhatsAppApiError } from './whatsappApi.js';
import { REMINDER_LINES, renderTemplate, saveWhatsAppSettings, TEMPLATE_BODY, templateValues, verifyChallenge, verifySignature, whatsappNumber, isStopMessage, applyDeliveryStatus, WhatsAppInputError, type WhatsAppMessageDoc } from './whatsapp.js';
import { hostelLabel } from './hostelName.js';

const cred = { phoneNumberId: '1234567890', wabaId: '9876543210', accessToken: 'TOKEN' };
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('plain-English WhatsApp errors', () => {
  it('explains the known codes and keeps the raw code for support', () => {
    expect(getMetaFailureCopy('131026: Message undeliverable')).toMatchObject({ code: '131026', title: expect.stringContaining('could not deliver') });
    expect(getMetaFailureCopy('190: token expired').title).toMatch(/expired/);
  });
  it('has a safe fallback for unknown codes and blanks, and treats "Stale:" specially', () => {
    expect(getMetaFailureCopy('999999: weird')).toMatchObject({ code: '999999', title: expect.stringContaining('did not deliver') });
    expect(getMetaFailureCopy('')).toMatchObject({ code: '' });
    expect(getMetaFailureCopy('Stale: no answer').title).toMatch(/never confirmed/);
    expect(parseMetaCode('no digits here')).toBe('');
  });
  it('never mentions a button that does not exist in this system', () => {
    for (const code of ['131026', '131048', '190', '131047', '999']) expect(JSON.stringify(getMetaFailureCopy(`${code}: x`))).not.toMatch(/Retry Failed/);
  });
});

describe('talking to WhatsApp', () => {
  it('sends an approved template to the right address with the four values, and returns the message id', async () => {
    const f = reply(200, { messages: [{ id: 'wamid.ABC' }] });
    const id = await sendTemplateMessage(cred, '919876543210', { name: 'order_not_acknowledged', language: 'en' }, ['Hostel', 'IR1', '06 Nov 2026', 'First.'], f);
    expect(id).toBe('wamid.ABC');
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe(`${GRAPH_URL}/1234567890/messages`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(String(init.body))).toEqual({ messaging_product: 'whatsapp', to: '919876543210', type: 'template', template: { name: 'order_not_acknowledged', language: { code: 'en' }, components: [{ type: 'body', parameters: ['Hostel', 'IR1', '06 Nov 2026', 'First.'].map((text) => ({ type: 'text', text })) }] } });
  });
  it('raises Meta’s own error with its code', async () => {
    const f = reply(400, { error: { code: 132001, message: 'Template name does not exist' } });
    await expect(sendTemplateMessage(cred, '91x', { name: 'x', language: 'en' }, [], f)).rejects.toMatchObject({ code: '132001', status: 400 });
    await expect(sendTemplateMessage(cred, '91x', { name: 'x', language: 'en' }, [], f)).rejects.toBeInstanceOf(WhatsAppApiError);
  });
  it('treats an answer with no message id as a failure, and a non-JSON error body safely', async () => {
    await expect(sendTemplateMessage(cred, '91x', { name: 'x', language: 'en' }, [], reply(200, {}))).rejects.toMatchObject({ code: 'no-id' });
    const bad = vi.fn(async () => new Response('<html>oops</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(sendTemplateMessage(cred, '91x', { name: 'x', language: 'en' }, [], bad)).rejects.toMatchObject({ status: 502 });
  });
  it('submits the template for approval with sample values', async () => {
    const f = reply(200, { id: '555', status: 'PENDING' });
    expect(await createTemplate(cred, { name: 'order_not_acknowledged', language: 'en', category: 'UTILITY', bodyText: TEMPLATE_BODY, example: ['a', 'b', 'c', 'd'] }, f)).toEqual({ id: '555', status: 'PENDING' });
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe(`${GRAPH_URL}/9876543210/message_templates`);
    expect(JSON.parse(String(init.body))).toMatchObject({ category: 'UTILITY', components: [{ type: 'BODY', text: TEMPLATE_BODY, example: { body_text: [['a', 'b', 'c', 'd']] } }] });
  });
  it('reads a template’s approval status', async () => {
    const f = reply(200, { data: [{ name: 'order_not_acknowledged', language: 'en', status: 'REJECTED', rejected_reason: 'INCORRECT_CATEGORY' }] });
    expect(await getTemplateStatus(cred, 'order_not_acknowledged', 'en', f)).toEqual({ status: 'REJECTED', reason: 'INCORRECT_CATEGORY' });
    expect(await getTemplateStatus(cred, 'other', 'en', f)).toBeNull();
  });
});

describe('the message wording', () => {
  const o = { hostelName: '36260501312-KGBV MALDAKAL', requestId: 'IR202600009266', dispatchedOn: new Date('2026-11-05T18:30:00Z') };
  it('fills the four blanks and the text reads as the approved template', () => {
    const v = templateValues(o, 1, hostelLabel);
    expect(v).toEqual(['KGBV Maldakal', 'IR202600009266', '06 Nov 2026', REMINDER_LINES[0]]);
    expect(renderTemplate(v)).toBe('Hello KGBV Maldakal, the delivery for request IR202600009266 was dispatched on 06 Nov 2026 and has not been acknowledged on the portal yet. Please log in and acknowledge it. This is the first reminder. Thank you.');
  });
  it('changes only the last line for each reminder, never beyond the fourth', () => {
    for (let n = 1; n <= 4; n++) expect(templateValues(o, n, hostelLabel)[3]).toBe(REMINDER_LINES[n - 1]);
    expect(templateValues(o, 9, hostelLabel)[3]).toBe(REMINDER_LINES[3]);
  });
  it('follows Meta’s rules: no line breaks, tabs or runs of spaces in a value', () => {
    const v = templateValues({ ...o, hostelName: 'Hostel\n\tName   Two', requestId: 'IR 1\r\n' }, 1, (n) => n);
    for (const x of v) expect(x).not.toMatch(/[\n\r\t]| {2,}/);
  });
  it('the template does not start or end with a blank, or put two blanks side by side', () => {
    expect(TEMPLATE_BODY).not.toMatch(/^\{\{|\}\}$/);
    expect(TEMPLATE_BODY).not.toMatch(/\}\}\s*\{\{/);
  });
});

describe('phone numbers', () => {
  it.each([['9876543210', '919876543210'], ['+91 98765 43210', '919876543210'], ['919876543210', '919876543210'], ['098765 43210', null], ['1234567890', null], ['98765', null], ['', null], [undefined, null], ['abcdefghij', null]])('%j -> %j', (raw, want) => expect(whatsappNumber(raw)).toBe(want));
});

describe('webhook security', () => {
  const secret = 'app-secret'; const body = '{"entry":[]}';
  const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  it('accepts only a body signed with the app secret', () => {
    expect(verifySignature(body, sig, secret)).toBe(true);
    expect(verifySignature(body + ' ', sig, secret)).toBe(false);
    expect(verifySignature(body, sig, 'other')).toBe(false);
  });
  it('rejects anything unsigned or malformed, and never lets a missing secret through', () => {
    for (const h of [null, undefined, '', 'sha256=', 'md5=abc', sig.replace('sha256=', '')]) expect(verifySignature(body, h as string, secret)).toBe(false);
    expect(verifySignature(body, sig, '')).toBe(false);
  });
  it('checks the setup handshake token', () => {
    expect(verifyChallenge('subscribe', 'tok', 'tok')).toBe(true);
    expect(verifyChallenge('subscribe', 'bad', 'tok')).toBe(false);
    expect(verifyChallenge('other', 'tok', 'tok')).toBe(false);
    expect(verifyChallenge('subscribe', null, 'tok')).toBe(false);
    expect(verifyChallenge('subscribe', '', '')).toBe(false);
  });
  it('recognises a reply that asks us to stop', () => {
    for (const t of ['STOP', ' stop ', 'Stop.', 'unsubscribe', 'opt out']) expect(isStopMessage(t)).toBe(true);
    for (const t of ['please stop sending', 'ok', 'acknowledged', 'stopped']) expect(isStopMessage(t)).toBe(false);
  });
});

describe('delivery ticks', () => {
  function store(status: WhatsAppMessageDoc['status']) {
    const doc = { messageId: 'W1', direction: 'out', status, statusAt: new Date(0) } as WhatsAppMessageDoc;
    const c = { whatsappMessages: { updateOne: async (f: { messageId: string; status: { $in: string[] } }, u: { $set: Partial<WhatsAppMessageDoc> }) => { const ok = f.messageId === doc.messageId && f.status.$in.includes(doc.status); if (ok) Object.assign(doc, u.$set); return { matchedCount: ok ? 1 : 0 }; } } };
    return { c: c as never, doc };
  }
  it('moves sent -> delivered -> read, and ignores repeats and late older updates', async () => {
    const { c, doc } = store('sent');
    expect(await applyDeliveryStatus(c, 'W1', 'delivered', undefined)).toBe(true);
    expect(await applyDeliveryStatus(c, 'W1', 'delivered', undefined)).toBe(false);          // Meta redelivered it
    expect(await applyDeliveryStatus(c, 'W1', 'read', undefined)).toBe(true);
    expect(await applyDeliveryStatus(c, 'W1', 'sent', undefined)).toBe(false);               // a late "sent" must not undo "read"
    expect(await applyDeliveryStatus(c, 'W1', 'delivered', undefined)).toBe(false);
    expect(doc.status).toBe('read');
  });
  it('records why a message failed, in Meta’s words', async () => {
    const { c, doc } = store('sent');
    expect(await applyDeliveryStatus(c, 'W1', 'failed', [{ code: 131026, title: 'Message undeliverable' }])).toBe(true);
    expect(doc).toMatchObject({ status: 'failed', errorText: '131026: Message undeliverable', errorCode: '131026' });
  });
  it('ignores statuses it does not know', async () => { expect(await applyDeliveryStatus(store('sent').c, 'W1', 'deleted', undefined)).toBe(false); });
});

describe('settings', () => {
  function settingsDb() {
    const doc: { value?: Record<string, unknown> } = {}; const audit: unknown[] = [];
    const c = {
      settings: { findOne: async () => (doc.value ? { _id: 'whatsapp', value: doc.value } : null), updateOne: async (_f: unknown, u: { $set?: { value: Record<string, unknown> }; $setOnInsert?: { value: Record<string, unknown> } }) => { if (u.$set) doc.value = u.$set.value; else if (u.$setOnInsert && !doc.value) doc.value = u.$setOnInsert.value; } },
      auditLog: { insertOne: async (a: unknown) => { audit.push(a); } },
    };
    return { c: c as never, doc, audit };
  }
  vi.stubEnv('CREDENTIAL_ENC_KEY', 'a'.repeat(64));
  it('starts in preview mode with the approved rules and a stable setup token', async () => {
    const { c } = settingsDb();
    const a = await saveWhatsAppSettings(c, {}, 'admin');
    expect(a).toMatchObject({ mode: 'dry_run', firstAfterDays: 3, everyDays: 2, maxMessages: 4 });
    const b = await saveWhatsAppSettings(c, { everyDays: 3 }, 'admin');
    expect(b.verifyToken).toBe(a.verifyToken);
    expect(b.everyDays).toBe(3);
  });
  it('stores the secrets sealed, keeps them when the box is left empty, and never writes them to the change log', async () => {
    const { c, doc, audit } = settingsDb();
    const a = await saveWhatsAppSettings(c, { accessToken: 'SECRET-TOKEN', appSecret: 'SECRET-APP' }, 'admin');
    expect(a.accessTokenEnc).toBeTruthy(); expect(JSON.stringify(doc)).not.toContain('SECRET-TOKEN');
    expect(JSON.stringify(audit)).not.toMatch(/SECRET/);
    const b = await saveWhatsAppSettings(c, { accessToken: '  ' }, 'admin');
    expect(b.accessTokenEnc).toBe(a.accessTokenEnc);
  });
  it('refuses bad numbers and odd values', async () => {
    const { c } = settingsDb();
    for (const bad of [{ firstAfterDays: 0 }, { everyDays: 31 }, { maxMessages: 5 }, { maxMessages: 0 }, { windowFrom: 25 }, { windowFrom: 18, windowTo: 9 }, { phoneNumberId: 'abc' }, { templateName: 'Has Spaces' }, { language: 'english' }, { mode: 'sometimes' }]) {
      await expect(saveWhatsAppSettings(c, bad, 'admin')).rejects.toBeInstanceOf(WhatsAppInputError);
    }
  });
  it('will not go live until everything is set up and the template is approved', async () => {
    const { c } = settingsDb();
    await expect(saveWhatsAppSettings(c, { mode: 'live' }, 'admin')).rejects.toThrow(/needs: phone number ID/);
    await saveWhatsAppSettings(c, { phoneNumberId: '1234567', wabaId: '7654321', accessToken: 't', appSecret: 's' }, 'admin');
    await expect(saveWhatsAppSettings(c, { mode: 'live' }, 'admin')).rejects.toThrow(/approved/);
  });
});
