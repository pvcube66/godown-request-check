import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ requireAccess: vi.fn(), sendMessages: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/viewer', () => ({ requireAccess: h.requireAccess, actorOf: (v: { id: string }) => `user:${v.id}` }));
vi.mock('@/lib/db', () => ({ getDb: async () => ({}) }));
vi.mock('@anomaly/core', async (orig) => ({ ...(await orig<typeof import('@anomaly/core')>()), sendMessages: h.sendMessages }));

import { WhatsAppInputError } from '@anomaly/core';
import { sendAction, type SendInput } from './actions';

const input: SendInput = { kind: 'template', template: { name: 'hello', language: 'en' }, body: ['a'], header: [], phones: ['919876543210'], groups: [], batchId: 'b1' };
beforeEach(() => { vi.clearAllMocks(); h.requireAccess.mockResolvedValue({ id: 'a1', role: 'admin' }); h.sendMessages.mockResolvedValue({ preview: true, results: [], sent: 0, failed: 0, skipped: 0, stopped: null, mode: 'live' }); });

describe('send message', () => {
  it('is administrators only', async () => {
    h.requireAccess.mockRejectedValue(new Error('no'));
    expect((await sendAction(input, true)).ok).toBe(false);
    expect(h.sendMessages).not.toHaveBeenCalled();
  });
  it('anything but an explicit "false" is only a preview', async () => {
    await sendAction(input, undefined as never);
    expect(h.sendMessages.mock.calls[0]![2]).toMatchObject({ preview: true, actor: 'user:a1' });
    await sendAction(input, false);
    expect(h.sendMessages.mock.calls[1]![2]).toMatchObject({ preview: false });
  });
  it('rejects malformed input without calling the core', async () => {
    for (const bad of [{ ...input, kind: 'x' }, { ...input, phones: 'nope' }, { ...input, body: [1] }, { ...input, batchId: 5 }, { ...input, template: undefined }, { ...input, groups: Array(60).fill('g') }] as never[]) expect((await sendAction(bad, true)).ok).toBe(false);
    expect(h.sendMessages).not.toHaveBeenCalled();
  });
  it('shows plain errors and hides unexpected ones', async () => {
    h.sendMessages.mockRejectedValueOnce(new WhatsAppInputError('Only approved templates can be sent.'));
    expect(await sendAction(input, true)).toEqual({ ok: false, message: 'Only approved templates can be sent.' });
    h.sendMessages.mockRejectedValueOnce(new Error('secret stack'));
    expect(JSON.stringify(await sendAction(input, true))).not.toMatch(/secret/);
  });
});
