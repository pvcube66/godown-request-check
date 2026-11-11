import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ requireAccess: vi.fn(), syncTemplates: vi.fn(), saveDraft: vi.fn(), submitTemplate: vi.fn(), removeTemplate: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/viewer', () => ({ requireAccess: h.requireAccess, actorOf: (v: { id: string }) => `user:${v.id}` }));
vi.mock('@/lib/db', () => ({ getDb: async () => ({}) }));
vi.mock('@anomaly/core', async (orig) => ({ ...(await orig<typeof import('@anomaly/core')>()), syncTemplates: h.syncTemplates, saveDraft: h.saveDraft, submitTemplate: h.submitTemplate, removeTemplate: h.removeTemplate, ensureWhatsAppSettings: async () => ({}) }));

import { WhatsAppApiError, WhatsAppInputError, type TemplateForm } from '@anomaly/core';
import { deleteTemplateAction, saveDraftAction, submitTemplateFormAction, syncTemplatesAction } from './actions';

const form = (o: Partial<TemplateForm> = {}): TemplateForm => ({ name: 'delivery_update', language: 'en', category: 'UTILITY', headerText: '', body: 'Hello {{1}}, your delivery is on the way. Thank you.', examples: ['Ravi'], headerExample: '', footer: '', buttons: [], ...o });
beforeEach(() => { vi.clearAllMocks(); h.requireAccess.mockResolvedValue({ id: 'a1', role: 'admin' }); });

describe('templates are for administrators', () => {
  it('refuses everyone else before doing anything', async () => {
    h.requireAccess.mockRejectedValue(new Error('admins only'));
    const rs = [await syncTemplatesAction(), await saveDraftAction(form()), await submitTemplateFormAction(form()), await deleteTemplateAction('a', 'en')];
    for (const r of rs) expect(r.ok).toBe(false);
    for (const f of [h.syncTemplates, h.saveDraft, h.submitTemplate, h.removeTemplate]) expect(f).not.toHaveBeenCalled();
  });
});

describe('the actions', () => {
  it('sync says how many templates there are', async () => {
    h.syncTemplates.mockResolvedValue({ total: 3, removed: 1 });
    expect((await syncTemplatesAction()).message).toMatch(/3 templates.*1 no longer exists/);
  });
  it('sending a template that breaks Meta rules never reaches Meta, and lists the problems', async () => {
    const r = await submitTemplateFormAction(form({ body: '{{1}} hello there friend' }));
    expect(r.ok).toBe(false); expect(r.errors?.length).toBeGreaterThan(0);
    expect(h.submitTemplate).not.toHaveBeenCalled();
  });
  it('sends a good one, cleaning the input first', async () => {
    h.submitTemplate.mockResolvedValue({ id: 'T1', status: 'PENDING' });
    const r = await submitTemplateFormAction(form({ name: '  delivery_update ', category: 'weird' as never, buttons: [{ type: 'EVIL' as never, text: 'ok' }] }));
    expect(r.ok).toBe(true);
    const sent = h.submitTemplate.mock.calls[0]![2] as TemplateForm;
    expect(sent.name).toBe('delivery_update'); expect(sent.category).toBe('UTILITY'); expect(sent.buttons[0]!.type).toBe('QUICK_REPLY');
  });
  it('cuts absurdly long input', async () => {
    h.saveDraft.mockResolvedValue(undefined);
    await saveDraftAction(form({ body: 'x'.repeat(5000), footer: 'f'.repeat(5000) }));
    const d = h.saveDraft.mock.calls[0]![1] as TemplateForm;
    expect(d.body.length).toBeLessThanOrEqual(1200); expect(d.footer.length).toBeLessThanOrEqual(200);
  });
  it('shows WhatsApp’s own reason when it refuses', async () => {
    h.submitTemplate.mockRejectedValue(new WhatsAppApiError('100: Invalid parameter: template name already exists', '100', 400));
    expect((await submitTemplateFormAction(form())).message).toMatch(/template name already exists/);
    h.removeTemplate.mockRejectedValue(new WhatsAppInputError('That template no longer exists.'));
    expect((await deleteTemplateAction('x', 'en')).message).toBe('That template no longer exists.');
  });
  it('rejects malformed delete requests', async () => {
    expect((await deleteTemplateAction('x'.repeat(600), 'en')).ok).toBe(false);
    expect(h.removeTemplate).not.toHaveBeenCalled();
  });
});
