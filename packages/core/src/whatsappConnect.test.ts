import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectManual, connectWithCode, connectionStatus, disconnect, fixWebhook, isConnected, saveMetaApp } from './whatsappConnect.js';
import { getWhatsAppSettings, WhatsAppInputError } from './whatsapp.js';
import { openSecret } from './secretBox.js';

beforeEach(() => { vi.stubEnv('CREDENTIAL_ENC_KEY', 'ef'.repeat(32)); });

function db() {
  const doc: { value?: Record<string, unknown> } = {}; const audit: { action: string; details?: unknown }[] = [];
  const setPath = (o: Record<string, unknown>, path: string, v: unknown) => { const k = path.split('.'); let cur = o; for (const p of k.slice(0, -1)) cur = (cur[p] ??= {}) as Record<string, unknown>; cur[k.at(-1)!] = v; };
  const c = {
    settings: {
      findOne: async () => (doc.value ? { _id: 'whatsapp', value: doc.value } : null),
      updateOne: async (_f: unknown, u: { $set?: Record<string, unknown>; $setOnInsert?: { value: Record<string, unknown> } }) => {
        if (u.$setOnInsert && !doc.value) doc.value = u.$setOnInsert.value;
        for (const [k, v] of Object.entries(u.$set ?? {})) { if (k.startsWith('value.')) { doc.value ??= {}; setPath(doc.value, k.slice(6), v); } }
      },
    },
    auditLog: { insertOne: async (a: { action: string; details?: unknown }) => { audit.push(a); } },
  };
  return { c: c as never, doc, audit };
}

type Route = (url: string, init?: RequestInit) => unknown;
const meta = (routes: Record<string, Route>) => vi.fn(async (url: string, init?: RequestInit) => {
  const key = Object.keys(routes).find((k) => url.includes(k));
  if (!key) return new Response(JSON.stringify({ error: { code: 100, message: `unexpected call ${url}` } }), { status: 404 });
  const out = routes[key]!(url, init) as { __status?: number; __body?: unknown };
  return new Response(JSON.stringify(out.__body ?? out), { status: out.__status ?? 200 });
}) as unknown as typeof fetch;

const happy = (over: Record<string, Route> = {}) => meta({
  'oauth/access_token': () => ({ access_token: 'TOKEN-FROM-CODE' }),
  'debug_token': () => ({ data: { is_valid: true, granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA1'] }, { scope: 'whatsapp_business_messaging', target_ids: ['WABA1'] }] } }),
  'WABA1/phone_numbers': () => ({ data: [{ id: '111111', display_phone_number: '+91 98765 43210', verified_name: 'Dept' }, { id: '222222', display_phone_number: '+91 90000 00000', verified_name: 'Other' }] }),
  'WABA1/subscribed_apps': (_u, init) => (init?.method === 'POST' ? { success: true } : { data: [{ whatsapp_business_api_data: { id: '7770001' } }] }),
  '111111/register': () => ({ success: true }),
  '222222/register': () => ({ success: true }),
  ...over,
});

async function withApp() {
  const t = db();
  await saveMetaApp(t.c, { appId: '7770001', appSecret: 'APP-SECRET', configId: '999999' }, 'admin');
  return { ...t, s: async () => getWhatsAppSettings(t.c) };
}

describe('the Meta app', () => {
  it('is saved with the secret sealed, and checked', async () => {
    const { doc, audit, s } = await withApp();
    const st = await s();
    expect(st).toMatchObject({ appId: '7770001', configId: '999999' });
    expect(JSON.stringify(doc)).not.toContain('APP-SECRET');
    expect(JSON.stringify(audit)).not.toContain('APP-SECRET');
    expect(openSecret(st.appSecretEnc!)).toBe('APP-SECRET');
  });
  it('refuses ids that are not digits', async () => {
    const { c } = db();
    await expect(saveMetaApp(c, { appId: 'abc' }, 'a')).rejects.toBeInstanceOf(WhatsAppInputError);
    await expect(saveMetaApp(c, { configId: '12 3' }, 'a')).rejects.toBeInstanceOf(WhatsAppInputError);
  });
});

describe('connecting with an access token', () => {
  it('finds the business account from the token, checks the number, saves, subscribes and registers', async () => {
    const t = await withApp(); const f = happy();
    const r = await connectManual(t.c, await t.s(), 'PERMANENT-TOKEN', '111111', 'admin', f);
    expect(r).toEqual({ wabaId: 'WABA1', phoneNumberId: '111111', displayPhone: '+91 98765 43210', webhookSubscribed: true, registered: true });
    const st = await t.s();
    expect(isConnected(st)).toBe(true);
    expect(st).toMatchObject({ wabaId: 'WABA1', phoneNumberId: '111111', displayPhone: '+91 98765 43210', verifiedName: 'Dept' });
    expect(openSecret(st.accessTokenEnc!)).toBe('PERMANENT-TOKEN');
    expect(JSON.stringify(t.doc)).not.toContain('PERMANENT-TOKEN');
    expect(JSON.stringify(t.audit)).not.toContain('PERMANENT-TOKEN');
    expect(t.audit.some((a) => a.action === 'whatsapp.connect')).toBe(true);
  });
  it('refuses an invalid token, a token with no WhatsApp account, and a phone number that is not in the account', async () => {
    const t = await withApp();
    await expect(connectManual(t.c, await t.s(), 'T', '111111', 'a', happy({ 'debug_token': () => ({ data: { is_valid: false } }) }))).rejects.toThrow(/not valid/);
    await expect(connectManual(t.c, await t.s(), 'T', '111111', 'a', happy({ 'debug_token': () => ({ data: { is_valid: true, granular_scopes: [] } }) }))).rejects.toThrow(/no access to a WhatsApp Business Account/);
    await expect(connectManual(t.c, await t.s(), 'T', '333333', 'a', happy())).rejects.toThrow(/333333 was not found.*\+91 98765 43210/);
    expect(isConnected(await t.s())).toBe(false);                                   // nothing was saved
  });
  it('needs the Meta app saved first, and sensible input', async () => {
    const { c } = db();
    await expect(connectManual(c, await getWhatsAppSettings(c), 'T', '111111', 'a', happy())).rejects.toThrow(/App ID and App secret/);
    const t = await withApp();
    await expect(connectManual(t.c, await t.s(), '', '111111', 'a', happy())).rejects.toBeInstanceOf(WhatsAppInputError);
    await expect(connectManual(t.c, await t.s(), 'T', 'abc', 'a', happy())).rejects.toBeInstanceOf(WhatsAppInputError);
  });
  it('still connects when the webhook subscription or number registration is refused, and says so', async () => {
    const t = await withApp();
    const f = happy({ 'WABA1/subscribed_apps': () => ({ __status: 400, __body: { error: { code: 200, message: 'no permission' } } }), '111111/register': () => ({ __status: 400, __body: { error: { code: 100, message: 'already registered' } } }) });
    const r = await connectManual(t.c, await t.s(), 'T', '111111', 'a', f);
    expect(r).toMatchObject({ webhookSubscribed: false, registered: false });
    expect(isConnected(await t.s())).toBe(true);
  });
});

describe('one-click signup', () => {
  it('exchanges the code, then picks the first number of the account', async () => {
    const t = await withApp(); const f = happy();
    const r = await connectWithCode(t.c, await t.s(), 'CODE-123', 'admin', f);
    expect(r).toMatchObject({ wabaId: 'WABA1', phoneNumberId: '111111' });
    expect(openSecret((await t.s()).accessTokenEnc!)).toBe('TOKEN-FROM-CODE');
    const call = (f as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0];
    expect(call).toContain('client_id=7770001'); expect(call).toContain('code=CODE-123');
  });
  it('refuses a missing code and an answer without a token', async () => {
    const t = await withApp();
    await expect(connectWithCode(t.c, await t.s(), '  ', 'a', happy())).rejects.toThrow(/Missing sign-up code/);
    await expect(connectWithCode(t.c, await t.s(), 'C', 'a', happy({ 'oauth/access_token': () => ({}) }))).rejects.toThrow(/did not return an access token/);
  });
});

describe('the verify step', () => {
  it('reports the discovered values and each live check', async () => {
    const t = await withApp();
    await connectManual(t.c, await t.s(), 'T', '111111', 'a', happy());
    const st = await connectionStatus(await t.s(), happy());
    expect(st.connected).toBe(true);
    expect(st.variables).toMatchObject({ wabaId: 'WABA1', phoneNumberId: '111111', displayPhone: '+91 98765 43210' });
    expect(st.checks).toEqual({ tokenValid: true, webhookSubscribed: true, templateApproved: false });
  });
  it('a failed check is just "not OK", never an error; an unsubscribed webhook can be fixed', async () => {
    const t = await withApp();
    await connectManual(t.c, await t.s(), 'T', '111111', 'a', happy());
    const bad = happy({ 'debug_token': () => ({ __status: 500, __body: {} }), 'WABA1/subscribed_apps': () => ({ data: [] }) });
    expect((await connectionStatus(await t.s(), bad)).checks).toMatchObject({ tokenValid: false, webhookSubscribed: false });
    expect(await fixWebhook(t.c, await t.s(), 'admin', happy())).toBe(true);
  });
  it('says "not connected" before anything is saved', async () => {
    const { c } = db();
    expect((await connectionStatus(await getWhatsAppSettings(c))).connected).toBe(false);
    await expect(fixWebhook(c, await getWhatsAppSettings(c), 'a')).rejects.toBeInstanceOf(WhatsAppInputError);
  });
});

describe('disconnecting', () => {
  it('forgets the token and numbers, keeps the Meta app and rules, and falls back to preview', async () => {
    const t = await withApp();
    await connectManual(t.c, await t.s(), 'T', '111111', 'a', happy());
    await disconnect(t.c, 'admin');
    const st = await t.s();
    expect(isConnected(st)).toBe(false);
    expect(st).toMatchObject({ accessTokenEnc: null, wabaId: '', phoneNumberId: '', mode: 'dry_run', appId: '7770001', firstAfterDays: 3 });
  });
});
