import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ requireAccess: vi.fn(), saveContact: vi.fn(), editContact: vi.fn(), deleteContacts: vi.fn(), setOptOut: vi.fn(), addHostelContacts: vi.fn(), createGroup: vi.fn(), addToGroup: vi.fn(), removeFromGroup: vi.fn(), deleteGroup: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/viewer', () => ({ requireAccess: h.requireAccess, actorOf: (v: { id: string }) => `user:${v.id}` }));
vi.mock('@/lib/db', () => ({ getDb: async () => ({}) }));
vi.mock('@anomaly/core', async (orig) => ({ ...(await orig<typeof import('@anomaly/core')>()), saveContact: h.saveContact, editContact: h.editContact, deleteContacts: h.deleteContacts, setOptOut: h.setOptOut, addHostelContacts: h.addHostelContacts, createGroup: h.createGroup, addToGroup: h.addToGroup, removeFromGroup: h.removeFromGroup, deleteGroup: h.deleteGroup }));

import { ContactInputError } from '@anomaly/core';
import { addHostelsAction, addToGroupAction, createGroupAction, deleteContactsAction, deleteGroupAction, optOutAction, removeFromGroupAction, saveContactAction } from './actions';

const input = { phone: '919876543210', name: 'Ravi', email: '', tags: 'a', notes: '', editing: false };
beforeEach(() => { vi.clearAllMocks(); h.requireAccess.mockResolvedValue({ id: 'a1', role: 'admin' }); });

describe('people are for administrators', () => {
  it('refuses everyone else before touching anything', async () => {
    h.requireAccess.mockRejectedValue(new Error('admins only'));
    const rs = [await saveContactAction(input), await deleteContactsAction(['1']), await optOutAction(['1'], true), await addHostelsAction(), await createGroupAction('g', []), await addToGroupAction('g', ['1']), await removeFromGroupAction('g', ['1']), await deleteGroupAction('g')];
    for (const r of rs) expect(r.ok).toBe(false);
    for (const f of Object.values(h)) if (f !== h.requireAccess) expect(f).not.toHaveBeenCalled();
  });
});

describe('the actions', () => {
  it('adds a contact and says so', async () => {
    h.saveContact.mockResolvedValue({ created: true });
    expect(await saveContactAction(input)).toEqual({ ok: true, message: 'Contact added.' });
  });
  it('says when the number was already saved', async () => {
    h.saveContact.mockResolvedValue({ created: false });
    expect((await saveContactAction(input)).message).toMatch(/already saved/);
  });
  it('edits when editing', async () => {
    expect((await saveContactAction({ ...input, editing: true })).ok).toBe(true);
    expect(h.editContact).toHaveBeenCalled(); expect(h.saveContact).not.toHaveBeenCalled();
  });
  it('passes plain-English validation errors through', async () => {
    h.saveContact.mockRejectedValue(new ContactInputError('That phone number is not valid.'));
    expect(await saveContactAction(input)).toEqual({ ok: false, message: 'That phone number is not valid.' });
  });
  it('hides unexpected errors', async () => {
    h.saveContact.mockRejectedValue(new Error('mongo exploded at 10.0.0.1'));
    expect((await saveContactAction(input)).message).not.toMatch(/mongo|10\.0/);
  });
  it('rejects oversize or wrong-typed input without calling the core', async () => {
    expect((await saveContactAction({ ...input, name: 'x'.repeat(500) })).ok).toBe(false);
    expect((await deleteContactsAction('nope' as never)).ok).toBe(false);
    expect((await deleteContactsAction(Array(1001).fill('1'))).ok).toBe(false);
    expect(h.saveContact).not.toHaveBeenCalled(); expect(h.deleteContacts).not.toHaveBeenCalled();
  });
  it('opt-out only ever sets true/false', async () => {
    await optOutAction(['9198'], 'yes' as never);
    expect(h.setOptOut.mock.calls[0]![2]).toBe(false);
  });
  it('counts deletes', async () => {
    h.deleteContacts.mockResolvedValue(1);
    expect((await deleteContactsAction(['9198'])).message).toBe('1 contact deleted.');
  });
});
