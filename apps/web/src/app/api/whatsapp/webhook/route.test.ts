import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { settings, processed } = vi.hoisted(() => ({ settings: { value: null as Record<string, unknown> | null }, processed: [] as unknown[] }));
vi.mock('@/lib/db', () => ({ getDb: async () => ({
  settings: { findOne: async () => (settings.value ? { _id: 'whatsapp', value: settings.value } : null) },
  whatsappMessages: { updateOne: async (...a: unknown[]) => { processed.push(a); return { matchedCount: 1 }; } },
  hostelsMaster: {}, auditLog: {},
}) }));

import { sealSecret } from '@anomaly/core';
import { GET, POST } from './route';

const SECRET = 'meta-app-secret';
const hook = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '555' }, statuses: [{ id: 'wamid.1', status: 'delivered' }] } }] }] });
const sign = (b: string, s = SECRET) => `sha256=${createHmac('sha256', s).update(b).digest('hex')}`;
const post = (body: string, sig?: string) => new Request('https://x.test/api/whatsapp/webhook', { method: 'POST', body, headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': sig } : {}) } });

beforeEach(() => {
  vi.stubEnv('CREDENTIAL_ENC_KEY', 'cd'.repeat(32));
  processed.length = 0;
  settings.value = { phoneNumberId: '555', verifyToken: 'setup-token', appSecretEnc: sealSecret(SECRET) };
});

describe('setup handshake', () => {
  const get = (q: string) => GET(new Request(`https://x.test/api/whatsapp/webhook?${q}`));
  it('answers with the challenge only for the right token', async () => {
    const ok = await get('hub.mode=subscribe&hub.verify_token=setup-token&hub.challenge=1234');
    expect([ok.status, await ok.text()]).toEqual([200, '1234']);
    expect((await get('hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1234')).status).toBe(403);
    expect((await get('hub.mode=subscribe&hub.challenge=1234')).status).toBe(403);
    expect((await get('hub.mode=other&hub.verify_token=setup-token')).status).toBe(403);
  });
});

describe('incoming updates', () => {
  it('accepts a correctly signed update and applies it', async () => {
    const r = await POST(post(hook, sign(hook)));
    expect(r.status).toBe(200);
    expect(processed).toHaveLength(1);
  });
  it('refuses unsigned, wrongly signed and tampered updates, and applies nothing', async () => {
    expect((await POST(post(hook))).status).toBe(401);
    expect((await POST(post(hook, sign(hook, 'someone-else')))).status).toBe(401);
    expect((await POST(post(hook + ' ', sign(hook)))).status).toBe(401);
    expect(processed).toHaveLength(0);
  });
  it('refuses everything until the app secret has been saved (no way to skip the check)', async () => {
    settings.value = { phoneNumberId: '555', verifyToken: 'setup-token' };
    expect((await POST(post(hook, sign(hook)))).status).toBe(401);
    settings.value = null;
    expect((await POST(post(hook, sign(hook)))).status).toBe(401);
    expect(processed).toHaveLength(0);
  });
  it('refuses a signed body that is not JSON, and an oversized one', async () => {
    const junk = 'not json';
    expect((await POST(post(junk, sign(junk)))).status).toBe(400);
    const huge = 'x'.repeat(1_000_001);
    expect((await POST(post(huge, sign(huge)))).status).toBe(413);
  });
});
