import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildComponents, previewText, removeTemplate, saveDraft, submitTemplate, syncTemplates, validateTemplate, variablesIn, type TemplateCollections, type TemplateForm, type WaTemplateDoc } from './whatsappTemplates.js';
import { DEFAULT_SETTINGS, WhatsAppInputError } from './whatsapp.js';
import { sealSecret } from './secretBox.js';

beforeEach(() => { vi.stubEnv('CREDENTIAL_ENC_KEY', '12'.repeat(32)); });
const form = (o: Partial<TemplateForm> = {}): TemplateForm => ({ name: 'delivery_update', language: 'en', category: 'UTILITY', headerText: '', body: 'Hello {{1}}, your delivery {{2}} is on the way. Thank you.', examples: ['Ravi', 'IR123'], headerExample: '', footer: '', buttons: [], ...o });
const settings = () => ({ ...DEFAULT_SETTINGS(), phoneNumberId: '111111', wabaId: 'WABA1', accessTokenEnc: sealSecret('TOK') });

describe('Meta’s template rules, in plain words', () => {
  it('accepts a good template', () => expect(validateTemplate(form())).toEqual([]));
  it.each([
    [{ name: 'Delivery Update' }, /lower-case/], [{ name: '1abc' }, /starts with a letter/],
    [{ body: '' }, /Write the message/], [{ body: 'x'.repeat(1025) }, /longer than 1024/],
    [{ body: 'Hello {{1}} and {{3}} bye', examples: ['a', 'b', 'c'] }, /numbered in order/],
    [{ body: '{{1}} hello there friend', examples: ['a'] }, /start or end with a variable/],
    [{ body: 'Hello there {{1}}', examples: ['a'] }, /start or end with a variable/],
    [{ body: 'Hello {{1}}{{2}} there friend', examples: ['a', 'b'] }, /next to each other/],
    [{ examples: ['Ravi'] }, /example value for every variable/], [{ examples: ['Ravi', ''] }, /example value for every variable/],
    [{ examples: ['Ra\nvi', 'x'] }, /line breaks/],
    [{ headerText: 'h'.repeat(61) }, /header is longer/], [{ headerText: 'Hi {{1}} {{2}}' }, /at most one variable/], [{ headerText: 'Hi {{1}}' }, /header variable/],
    [{ footer: 'f'.repeat(61) }, /footer is longer/], [{ footer: 'Hi {{1}}' }, /footer cannot contain/],
    [{ buttons: [{ type: 'URL', text: 'Open', url: 'http://x.com' }] }, /https/], [{ buttons: [{ type: 'PHONE_NUMBER', text: 'Call', phone_number: '12345' }] }, /\+919876543210/],
    [{ buttons: [{ type: 'QUICK_REPLY', text: '' }] }, /1 to 25/],
    [{ buttons: Array.from({ length: 4 }, (_, i) => ({ type: 'QUICK_REPLY' as const, text: `b${i}` })) }, /At most 3 quick/],
  ])('refuses %j', (over, re) => expect(validateTemplate(form(over as Partial<TemplateForm>)).join(' | ')).toMatch(re as RegExp));
  it('a text with no variables needs no examples', () => expect(validateTemplate(form({ body: 'Your delivery is on the way. Thank you.', examples: [] }))).toEqual([]));
  it('finds variables in order', () => expect(variablesIn('a {{2}} b {{1}} {{2}}')).toEqual([1, 2]));
});

describe('what is sent to Meta', () => {
  it('builds header, body with examples, footer and buttons', () => {
    const c = buildComponents(form({ headerText: 'Update for {{1}}', headerExample: 'Ravi', footer: 'Dept of Welfare', buttons: [{ type: 'QUICK_REPLY', text: 'Got it' }, { type: 'URL', text: 'Open', url: 'https://x.test' }, { type: 'PHONE_NUMBER', text: 'Call', phone_number: '+919876543210' }] }));
    expect(c[0]).toMatchObject({ type: 'HEADER', format: 'TEXT', example: { header_text: [['Ravi'].toString()] } });
    expect(c[1]).toEqual({ type: 'BODY', text: 'Hello {{1}}, your delivery {{2}} is on the way. Thank you.', example: { body_text: [['Ravi', 'IR123']] } });
    expect(c[2]).toEqual({ type: 'FOOTER', text: 'Dept of Welfare' });
    expect((c[3] as { buttons: unknown[] }).buttons).toHaveLength(3);
  });
  it('fills the preview with the examples', () => expect(previewText('Hello {{1}}, {{2}}!', ['Ravi'])).toBe('Hello Ravi, {{2}}!'));
});

function store() {
  const docs: WaTemplateDoc[] = []; const audit: unknown[] = [];
  const key = (f: { name: string; language?: string }) => docs.findIndex((d) => d.name === f.name && (f.language === undefined || d.language === f.language));
  const c = {
    waTemplates: {
      findOne: async (f: { name: string; language: string }) => docs[key(f)] ?? null,
      find: (f: { status?: { $ne: string } }) => ({ toArray: async () => docs.filter((d) => !f.status || d.status !== f.status.$ne) }),
      updateOne: async (f: { name: string; language: string }, u: { $set: Partial<WaTemplateDoc>; $setOnInsert?: Partial<WaTemplateDoc> }) => { const i = key(f); if (i >= 0) Object.assign(docs[i]!, u.$set); else docs.push({ ...u.$setOnInsert, ...u.$set } as WaTemplateDoc); },
      deleteOne: async (f: { name: string; language: string }) => { const i = key(f); if (i >= 0) docs.splice(i, 1); },
      deleteMany: async (f: { name: string; language?: string }) => { for (let i = docs.length - 1; i >= 0; i--) if (docs[i]!.name === f.name && (f.language === undefined || docs[i]!.language === f.language)) docs.splice(i, 1); },
    },
    settings: {}, auditLog: { insertOne: async (a: unknown) => { audit.push(a); } },
  } as unknown as TemplateCollections;
  return { c, docs, audit };
}
const reply = (routes: Record<string, (init?: RequestInit) => unknown>) => vi.fn(async (url: string, init?: RequestInit) => {
  const k = Object.keys(routes).find((x) => url.includes(x));
  return k ? new Response(JSON.stringify(routes[k]!(init)), { status: 200 }) : new Response(JSON.stringify({ error: { code: 100, message: `unexpected ${url}` } }), { status: 400 });
}) as unknown as typeof fetch;

describe('submitting, syncing, deleting', () => {
  it('submits for approval and keeps what was typed', async () => {
    const { c, docs } = store();
    const f = reply({ message_templates: () => ({ id: 'T1', status: 'PENDING' }) });
    expect(await submitTemplate(c, settings(), form(), 'admin', f)).toEqual({ id: 'T1', status: 'PENDING' });
    expect(docs[0]).toMatchObject({ name: 'delivery_update', status: 'PENDING', variables: 2, metaId: 'T1' });
    const sent = JSON.parse(String((f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1].body));
    expect(sent).toMatchObject({ name: 'delivery_update', category: 'UTILITY', language: 'en' });
  });
  it('refuses a bad template before calling Meta, and a name that is already taken', async () => {
    const { c } = store(); const f = reply({});
    await expect(submitTemplate(c, settings(), form({ body: '{{1}} hi there friend', examples: ['a'] }), 'a', f)).rejects.toBeInstanceOf(WhatsAppInputError);
    expect(f).not.toHaveBeenCalled();
    const g = reply({ message_templates: () => ({ id: 'T1', status: 'APPROVED' }) });
    await submitTemplate(c, settings(), form(), 'a', g);
    await expect(submitTemplate(c, settings(), form(), 'a', g)).rejects.toThrow(/already exists/);
  });
  it('needs WhatsApp to be connected', async () => {
    const { c } = store();
    await expect(submitTemplate(c, { ...settings(), accessTokenEnc: null }, form(), 'a', reply({}))).rejects.toThrow(/Connect WhatsApp/);
  });
  it('saves a draft without calling Meta, and a draft can later be sent', async () => {
    const { c, docs } = store();
    await saveDraft(c, form(), 'admin');
    expect(docs[0]).toMatchObject({ status: 'DRAFT', metaId: null });
    await saveDraft(c, form({ footer: 'edited' }), 'admin');
    expect(docs).toHaveLength(1); expect(docs[0]!.form?.footer).toBe('edited');
    await submitTemplate(c, settings(), form(), 'admin', reply({ message_templates: () => ({ id: 'T9', status: 'PENDING' }) }));
    expect(docs[0]!.status).toBe('PENDING');
  });
  it('syncs from Meta over several pages, updates statuses, drops what Meta removed, never touches drafts', async () => {
    const { c, docs } = store();
    await saveDraft(c, form({ name: 'my_draft' }), 'a');
    docs.push({ name: 'old_one', language: 'en', category: 'UTILITY', status: 'APPROVED', form: null, components: [], bodyText: '', variables: 0, metaId: 'X', reason: null, createdAt: new Date(), updatedAt: new Date(), syncedAt: null });
    let call = 0;
    const f = vi.fn(async () => new Response(JSON.stringify(call++ === 0
      ? { data: [{ id: '1', name: 'a_one', language: 'en', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi {{1}} there' }] }], paging: { next: 'https://graph.facebook.com/next-page' } }
      : { data: [{ id: '2', name: 'b_two', language: 'en', category: 'MARKETING', status: 'REJECTED', rejected_reason: 'INCORRECT_CATEGORY', components: [] }, { id: '3', name: 'gone_soon', language: 'en', category: 'UTILITY', status: 'PENDING_DELETION' }] }), { status: 200 })) as unknown as typeof fetch;
    expect(await syncTemplates(c, settings(), f)).toEqual({ total: 3, removed: 1 });
    expect(docs.map((d) => d.name).sort()).toEqual(['a_one', 'b_two', 'my_draft']);
    expect(docs.find((d) => d.name === 'b_two')).toMatchObject({ status: 'REJECTED', reason: 'INCORRECT_CATEGORY' });
    expect(docs.find((d) => d.name === 'a_one')).toMatchObject({ variables: 1, bodyText: 'Hi {{1}} there' });
  });
  it('deletes on Meta and here; a draft is removed only here', async () => {
    const { c, docs } = store(); const f = reply({ message_templates: (init) => (init?.method === 'DELETE' ? { success: true } : { id: 'T1', status: 'APPROVED' }) });
    await submitTemplate(c, settings(), form(), 'a', f);
    await removeTemplate(c, settings(), 'delivery_update', 'en', 'a', f);
    expect(docs).toHaveLength(0);
    await saveDraft(c, form({ name: 'd1' }), 'a');
    const g = reply({}); await removeTemplate(c, settings(), 'd1', 'en', 'a', g);
    expect(g).not.toHaveBeenCalled(); expect(docs).toHaveLength(0);
    await expect(removeTemplate(c, settings(), 'nope', 'en', 'a', f)).rejects.toThrow(/no longer exists/);
  });
});
