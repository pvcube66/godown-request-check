import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ requireAccess: vi.fn(), saveMetaApp: vi.fn(), connectWithCode: vi.fn(), connectManual: vi.fn(), connectionStatus: vi.fn(), fixWebhook: vi.fn(), disconnect: vi.fn(), ensure: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/viewer', () => ({ requireAccess: h.requireAccess, actorOf: (v: { id: string }) => `user:${v.id}` }));
vi.mock('@/lib/db', () => ({ getDb: async () => ({}) }));
vi.mock('@anomaly/core', async (orig) => ({ ...(await orig<typeof import('@anomaly/core')>()), saveMetaApp: h.saveMetaApp, connectWithCode: h.connectWithCode, connectManual: h.connectManual, connectionStatus: h.connectionStatus, fixWebhook: h.fixWebhook, disconnect: h.disconnect, ensureWhatsAppSettings: h.ensure }));

import { WhatsAppApiError, WhatsAppInputError } from '@anomaly/core';
import { connectCodeAction, connectManualAction, disconnectAction, fixWebhookAction, saveMetaAppAction, statusAction } from './actions';

beforeEach(() => { vi.clearAllMocks(); h.requireAccess.mockResolvedValue({ id: 'a1', role: 'admin' }); h.ensure.mockResolvedValue({ appId: '1' }); });

describe('connecting WhatsApp is for administrators', () => {
  it('refuses everyone else before touching Meta or the database', async () => {
    h.requireAccess.mockRejectedValue(new Error('admins only'));
    const results = [await saveMetaAppAction('1', 's', '2'), await connectCodeAction('c'), await connectManualAction('t', '12345'), await statusAction(), await fixWebhookAction(), await disconnectAction()];
    for (const r of results) expect(r.ok).toBe(false);
    for (const f of [h.saveMetaApp, h.connectWithCode, h.connectManual, h.connectionStatus, h.fixWebhook, h.disconnect]) expect(f).not.toHaveBeenCalled();
  });
});

describe('the actions', () => {
  it('connect with a code and with a token, naming the number', async () => {
    h.connectWithCode.mockResolvedValue({ displayPhone: '+91 98765 43210' });
    expect(await connectCodeAction('CODE')).toEqual({ ok: true, message: 'Connected +91 98765 43210.', data: { displayPhone: '+91 98765 43210' } });
    h.connectManual.mockResolvedValue({ displayPhone: '+91 90000 00000' });
    expect(await connectManualAction('TOKEN', '123456')).toMatchObject({ ok: true, data: { displayPhone: '+91 90000 00000' } });
    expect(h.connectManual).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'TOKEN', '123456', 'user:a1');
  });
  it('turns input mistakes and Meta errors into plain messages, never a stack trace or the token', async () => {
    h.connectManual.mockRejectedValue(new WhatsAppInputError('Meta says this access token is not valid, or it has expired.'));
    expect(await connectManualAction('T', '123456')).toEqual({ ok: false, message: 'Meta says this access token is not valid, or it has expired.' });
    h.connectWithCode.mockRejectedValue(new WhatsAppApiError('190: Error validating access token', '190', 401));
    const r = await connectCodeAction('C');
    expect(r.ok).toBe(false); expect(r.message).toMatch(/connection expired/i);
    h.connectManual.mockRejectedValue(new Error('boom: secret-token-xyz'));
    expect((await connectManualAction('secret-token-xyz', '123456')).message).not.toContain('secret-token-xyz');
  });
  it('rejects absurd input sizes before calling anything', async () => {
    expect((await connectCodeAction('x'.repeat(5000))).ok).toBe(false);
    expect((await connectManualAction('x'.repeat(2000), '1')).ok).toBe(false);
    expect(h.connectWithCode).not.toHaveBeenCalled(); expect(h.connectManual).not.toHaveBeenCalled();
  });
  it('sends the status with dates as text so the page can show it', async () => {
    h.connectionStatus.mockResolvedValue({ connected: true, variables: { wabaId: 'W', phoneNumberId: 'P', displayPhone: '+91', verifiedName: 'D', connectedAt: new Date('2026-11-11T00:00:00Z') }, checks: { tokenValid: true, webhookSubscribed: false, templateApproved: false } });
    const r = await statusAction();
    expect(r.data?.variables?.connectedAt).toBe('2026-11-11T00:00:00.000Z');
    expect(r.data?.checks.webhookSubscribed).toBe(false);
  });
  it('fix, disconnect and the Meta app', async () => {
    h.fixWebhook.mockResolvedValue(true); expect((await fixWebhookAction()).ok).toBe(true);
    h.fixWebhook.mockResolvedValue(false); expect((await fixWebhookAction()).ok).toBe(false);
    expect((await disconnectAction()).ok).toBe(true); expect(h.disconnect).toHaveBeenCalled();
    expect((await saveMetaAppAction('7770001', 'secret', '999999')).ok).toBe(true);
    expect(h.saveMetaApp).toHaveBeenCalledWith(expect.anything(), { appId: '7770001', appSecret: 'secret', configId: '999999' }, 'user:a1');
  });
});
