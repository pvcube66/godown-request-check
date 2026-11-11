import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ requireAccess: vi.fn(), reviewCampaign: vi.fn(), createCampaign: vi.fn(), changeCampaign: vi.fn(), retryFailed: vi.fn(), runCampaignBatch: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/viewer', () => ({ requireAccess: h.requireAccess, actorOf: (v: { id: string }) => `user:${v.id}` }));
vi.mock('@/lib/db', () => ({ getDb: async () => ({}) }));
vi.mock('@anomaly/core', async (orig) => ({ ...(await orig<typeof import('@anomaly/core')>()), reviewCampaign: h.reviewCampaign, createCampaign: h.createCampaign, changeCampaign: h.changeCampaign, retryFailed: h.retryFailed, runCampaignBatch: h.runCampaignBatch }));
import { WhatsAppInputError } from '@anomaly/core';
import { changeCampaignAction, createCampaignAction, retryFailedAction, reviewCampaignAction, tickCampaignAction } from './actions';

const ID = '0b9d1f1e-1111-4222-8333-444455556666';
const input = { name: 'Diwali', template: { name: 'hello', language: 'en' }, body: ['a'], header: [], audience: { tags: ['x'] } };
beforeEach(() => { vi.clearAllMocks(); h.requireAccess.mockResolvedValue({ id: 'a', role: 'admin' }); });

describe('campaign actions', () => {
  it('are administrators only', async () => {
    h.requireAccess.mockRejectedValue(new Error('no'));
    for (const r of [await reviewCampaignAction(input), await createCampaignAction(input), await changeCampaignAction(ID, 'start'), await retryFailedAction(ID), await tickCampaignAction(ID)]) expect(r.ok).toBe(false);
    for (const f of [h.reviewCampaign, h.createCampaign, h.changeCampaign, h.retryFailed, h.runCampaignBatch]) expect(f).not.toHaveBeenCalled();
  });
  it('reject odd ids, actions and input before touching anything', async () => {
    expect((await changeCampaignAction('x', 'start')).ok).toBe(false);
    expect((await changeCampaignAction(ID, 'delete')).ok).toBe(false);
    expect((await tickCampaignAction('../x')).ok).toBe(false);
    expect((await createCampaignAction({ ...input, body: [5] } as never)).ok).toBe(false);
    expect((await createCampaignAction({ ...input, audience: { tags: 'x' } } as never)).ok).toBe(false);
    for (const f of [h.createCampaign, h.changeCampaign, h.runCampaignBatch]) expect(f).not.toHaveBeenCalled();
  });
  it('create passes the actor and returns the id', async () => {
    h.createCampaign.mockResolvedValue({ campaignId: ID });
    expect(await createCampaignAction(input)).toEqual({ ok: true, id: ID });
    expect(h.createCampaign.mock.calls[0]![2]).toBe('user:a');
  });
  it('say what happened in plain words, and hide unexpected errors', async () => {
    expect(await changeCampaignAction(ID, 'pause')).toEqual({ ok: true, message: 'Campaign paused.' });
    h.changeCampaign.mockRejectedValueOnce(new WhatsAppInputError('WhatsApp is turned off. Turn it on in Settings first.'));
    expect((await changeCampaignAction(ID, 'start')).ok).toBe(false);
    h.retryFailed.mockResolvedValue(2); expect((await retryFailedAction(ID) as { message: string }).message).toMatch(/2 failed messages/);
    h.runCampaignBatch.mockRejectedValue(new Error('mongo at 10.1.1.1'));
    expect(JSON.stringify(await tickCampaignAction(ID))).not.toMatch(/mongo/);
  });
});
