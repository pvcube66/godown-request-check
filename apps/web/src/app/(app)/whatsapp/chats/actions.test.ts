import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ requireAccess: vi.fn(), markRead: vi.fn(), setConversationStatus: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/viewer', () => ({ requireAccess: h.requireAccess }));
vi.mock('@/lib/db', () => ({ getDb: async () => ({}) }));
vi.mock('@anomaly/core', async (orig) => ({ ...(await orig<typeof import('@anomaly/core')>()), markRead: h.markRead, setConversationStatus: h.setConversationStatus }));
import { markReadAction, setChatStatusAction } from './actions';

beforeEach(() => { vi.clearAllMocks(); h.requireAccess.mockResolvedValue({ id: 'a', role: 'admin' }); h.setConversationStatus.mockResolvedValue(true); });
describe('chat actions', () => {
  it('are administrators only', async () => {
    h.requireAccess.mockRejectedValue(new Error('no'));
    await markReadAction('919876543210'); expect((await setChatStatusAction('919876543210', 'closed')).ok).toBe(false);
    expect(h.markRead).not.toHaveBeenCalled(); expect(h.setConversationStatus).not.toHaveBeenCalled();
  });
  it('reject bad numbers and statuses', async () => {
    await markReadAction('abc'); expect(h.markRead).not.toHaveBeenCalled();
    expect((await setChatStatusAction('9198', 'closed')).ok).toBe(false);
    expect((await setChatStatusAction('919876543210', 'deleted')).ok).toBe(false);
    expect(h.setConversationStatus).not.toHaveBeenCalled();
  });
  it('close and reopen', async () => {
    expect((await setChatStatusAction('919876543210', 'closed')).message).toBe('Chat closed.');
    expect((await setChatStatusAction('919876543210', 'open')).message).toBe('Chat reopened.');
    h.setConversationStatus.mockResolvedValue(false);
    expect((await setChatStatusAction('919876543210', 'open')).ok).toBe(false);
  });
});
