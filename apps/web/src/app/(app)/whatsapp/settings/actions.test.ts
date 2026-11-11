import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ requireAccess: vi.fn(), saveBusinessProfile: vi.fn(), addQuickReply: vi.fn(), deleteQuickReply: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/viewer', () => ({ requireAccess: h.requireAccess, actorOf: (v: { id: string }) => `user:${v.id}` }));
vi.mock('@/lib/db', () => ({ getDb: async () => ({}) }));
vi.mock('@anomaly/core', async (orig) => ({ ...(await orig<typeof import('@anomaly/core')>()), ensureWhatsAppSettings: async () => ({}), saveBusinessProfile: h.saveBusinessProfile, addQuickReply: h.addQuickReply, deleteQuickReply: h.deleteQuickReply }));
import { WhatsAppApiError, WhatsAppInputError } from '@anomaly/core';
import { addQuickReplyAction, deleteQuickReplyAction, saveProfileAction } from './actions';

const profile = { about: 'a', description: 'd', address: '', email: '', websites: ['https://x.org'], vertical: 'GOVT', pictureUrl: '' };
beforeEach(() => { vi.clearAllMocks(); h.requireAccess.mockResolvedValue({ id: 'a', role: 'admin' }); });
describe('settings actions', () => {
  it('are administrators only', async () => {
    h.requireAccess.mockRejectedValue(new Error('no'));
    for (const r of [await saveProfileAction(profile), await addQuickReplyAction('t', 'x'), await deleteQuickReplyAction('t')]) expect(r.ok).toBe(false);
    for (const f of [h.saveBusinessProfile, h.addQuickReply, h.deleteQuickReply]) expect(f).not.toHaveBeenCalled();
  });
  it('reject malformed input before touching anything', async () => {
    expect((await saveProfileAction({ ...profile, websites: 'x' } as never)).ok).toBe(false);
    expect((await saveProfileAction({ ...profile, about: 5 } as never)).ok).toBe(false);
    expect((await addQuickReplyAction({} as never, 'x')).ok).toBe(false);
    expect(h.saveBusinessProfile).not.toHaveBeenCalled(); expect(h.addQuickReply).not.toHaveBeenCalled();
  });
  it('save and report', async () => {
    expect(await saveProfileAction(profile)).toEqual({ ok: true, message: 'Saved to WhatsApp.' });
    expect((await addQuickReplyAction('Thanks', 'Thank you')).ok).toBe(true);
    expect(h.addQuickReply.mock.calls[0]![3]).toBe('user:a');
  });
  it('explain Meta refusals in plain words and hide unexpected errors', async () => {
    h.saveBusinessProfile.mockRejectedValueOnce(new WhatsAppApiError('190: token expired', '190', 401));
    const r = await saveProfileAction(profile); expect(r.ok).toBe(false); expect(r.message).not.toMatch(/^190/);
    h.addQuickReply.mockRejectedValueOnce(new WhatsAppInputError('A quick reply with that title already exists.'));
    expect((await addQuickReplyAction('a', 'b')).message).toMatch(/already exists/);
    h.deleteQuickReply.mockRejectedValueOnce(new Error('db at 10.0.0.9'));
    expect(JSON.stringify(await deleteQuickReplyAction('a'))).not.toMatch(/10\.0/);
  });
});
