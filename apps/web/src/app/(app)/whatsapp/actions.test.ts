import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAccess, save, submit, refresh, hostelUpdate } = vi.hoisted(() => ({ requireAccess: vi.fn(), save: vi.fn(), submit: vi.fn(), refresh: vi.fn(), hostelUpdate: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/viewer', () => ({ requireAccess, actorOf: (v: { id: string }) => `user:${v.id}` }));
vi.mock('@/lib/db', () => ({ getDb: async () => ({ hostelsMaster: { updateOne: hostelUpdate }, auditLog: { insertOne: vi.fn() } }) }));
vi.mock('@anomaly/core', async (orig) => ({ ...(await orig<typeof import('@anomaly/core')>()), saveWhatsAppSettings: save, submitReminderTemplate: submit, refreshTemplateStatus: refresh }));

import { optOutAction, refreshTemplateAction, saveSettingsAction, submitTemplateAction } from './actions';

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
beforeEach(() => { vi.clearAllMocks(); requireAccess.mockResolvedValue({ id: 'a1', role: 'admin' }); });

describe('WhatsApp settings are for administrators', () => {
  it('refuses everyone else before touching anything', async () => {
    requireAccess.mockRejectedValue(new Error('admins only'));
    expect(await saveSettingsAction({}, form({ mode: 'live' }))).toHaveProperty('error');
    expect(await submitTemplateAction()).toHaveProperty('error');
    expect(await refreshTemplateAction()).toHaveProperty('error');
    expect(save).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
  });
  it('passes the form values through, leaving untouched boxes alone', async () => {
    await saveSettingsAction({}, form({ phoneNumberId: '123456', accessToken: '', everyDays: '3', mode: 'dry_run' }));
    expect(save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ phoneNumberId: '123456', accessToken: '', everyDays: 3, mode: 'dry_run', firstAfterDays: undefined }), 'user:a1');
  });
  it('turns a refusal from the settings code into a plain message', async () => {
    const { WhatsAppInputError } = await import('@anomaly/core');
    save.mockRejectedValue(new WhatsAppInputError('Live sending needs: access key.'));
    expect(await saveSettingsAction({}, form({ mode: 'live' }))).toEqual({ error: 'Live sending needs: access key.' });
  });
  it('shows WhatsApp’s own problem in plain words', async () => {
    const { WhatsAppApiError } = await import('@anomaly/core');
    submit.mockRejectedValue(new WhatsAppApiError('190: Error validating access token', '190', 401));
    expect((await submitTemplateAction()).error).toMatch(/connection expired/i);
  });
});

describe('recording that a hostel asked to stop', () => {
  it('needs an operator or administrator, and a real hostel', async () => {
    requireAccess.mockRejectedValue(new Error('read-only'));
    expect(await optOutAction({}, form({ godownId: '1', hostelCode: 'H1', stop: '1' }))).toHaveProperty('error');
    expect(hostelUpdate).not.toHaveBeenCalled();
    requireAccess.mockResolvedValue({ id: 'o1', role: 'operator' });
    hostelUpdate.mockResolvedValue({ matchedCount: 0 });
    expect(await optOutAction({}, form({ godownId: '1', hostelCode: 'H1', stop: '1' }))).toHaveProperty('error');
    hostelUpdate.mockResolvedValue({ matchedCount: 1 });
    expect(await optOutAction({}, form({ godownId: '1', hostelCode: 'H1', stop: '1' }))).toHaveProperty('success');
    expect(hostelUpdate).toHaveBeenLastCalledWith({ godownId: 1, hostelCode: 'H1' }, { $set: expect.objectContaining({ whatsappOptOut: true }) });
    expect(await optOutAction({}, form({ godownId: '1', hostelCode: 'H1', stop: '0' }))).toHaveProperty('success');
    expect(hostelUpdate).toHaveBeenLastCalledWith({ godownId: 1, hostelCode: 'H1' }, { $set: expect.objectContaining({ whatsappOptOut: false }) });
  });
  it('rejects a malformed hostel id', async () => {
    expect(await optOutAction({}, form({ godownId: 'x', hostelCode: 'H1', stop: '1' }))).toHaveProperty('error');
    expect(hostelUpdate).not.toHaveBeenCalled();
  });
});
