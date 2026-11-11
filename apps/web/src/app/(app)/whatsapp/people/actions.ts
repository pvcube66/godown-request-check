'use server';

import { revalidatePath } from 'next/cache';
import { addHostelContacts, addToGroup, ContactInputError, createGroup, deleteContacts, deleteGroup, editContact, removeFromGroup, saveContact, setOptOut } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { actorOf, requireAccess } from '@/lib/viewer';

export interface Result { ok: boolean; message: string }
const fail = (e: unknown): Result => (e instanceof ContactInputError ? { ok: false, message: e.message } : { ok: false, message: 'Something went wrong. Please sign in again if the page was left open, then try again.' });
const refresh = () => revalidatePath('/whatsapp/people');
const text = (v: unknown, max: number) => { if (typeof v !== 'string' || v.length > max) throw new ContactInputError('That value is not valid.'); return v; };
const phones = (v: unknown) => { if (!Array.isArray(v) || v.length > 1000 || v.some((p) => typeof p !== 'string' || p.length > 20)) throw new ContactInputError('Choose between 1 and 1000 contacts.'); return v as string[]; };

export async function saveContactAction(input: { phone: string; name: string; email: string; tags: string; notes: string; editing: boolean }): Promise<Result> {
  try {
    const viewer = await requireAccess('admin');
    const c = await getDb();
    const data = { phone: text(input.phone, 30), name: text(input.name, 200), email: text(input.email, 300), tags: text(input.tags, 400), notes: text(input.notes, 2000) };
    if (input.editing) await editContact(c, data.phone, data, actorOf(viewer));
    else { const r = await saveContact(c, data, actorOf(viewer)); refresh(); return { ok: true, message: r.created ? 'Contact added.' : 'That number was already saved, so its details were updated.' }; }
    refresh();
    return { ok: true, message: 'Saved.' };
  } catch (e) { return fail(e); }
}
export async function deleteContactsAction(list: string[]): Promise<Result> {
  try { const viewer = await requireAccess('admin'); const n = await deleteContacts(await getDb(), phones(list), actorOf(viewer)); refresh(); return { ok: true, message: `${n} contact${n === 1 ? '' : 's'} deleted.` }; } catch (e) { return fail(e); }
}
export async function optOutAction(list: string[], optedOut: boolean): Promise<Result> {
  try {
    const viewer = await requireAccess('admin'); const c = await getDb();
    for (const p of phones(list)) await setOptOut(c, p, optedOut === true, actorOf(viewer));
    refresh();
    return { ok: true, message: optedOut ? 'Marked as opted out. They will not be messaged.' : 'Opted back in.' };
  } catch (e) { return fail(e); }
}
export async function addHostelsAction(): Promise<Result> {
  try { const viewer = await requireAccess('admin'); const r = await addHostelContacts(await getDb(), actorOf(viewer)); refresh(); return { ok: true, message: `${r.added} hostel contact${r.added === 1 ? '' : 's'} added, ${r.updated} already there.` }; } catch (e) { return fail(e); }
}
export async function createGroupAction(name: string, list: string[]): Promise<Result> {
  try { const viewer = await requireAccess('admin'); await createGroup(await getDb(), text(name, 100), phones(list), actorOf(viewer)); refresh(); return { ok: true, message: 'Group created.' }; } catch (e) { return fail(e); }
}
export async function addToGroupAction(group: string, list: string[]): Promise<Result> {
  try { const viewer = await requireAccess('admin'); const n = await addToGroup(await getDb(), text(group, 100), phones(list), actorOf(viewer)); refresh(); return { ok: true, message: `${n} added to the group.` }; } catch (e) { return fail(e); }
}
export async function removeFromGroupAction(group: string, list: string[]): Promise<Result> {
  try { const viewer = await requireAccess('admin'); await removeFromGroup(await getDb(), text(group, 100), phones(list), actorOf(viewer)); refresh(); return { ok: true, message: 'Removed from the group.' }; } catch (e) { return fail(e); }
}
export async function deleteGroupAction(group: string): Promise<Result> {
  try { const viewer = await requireAccess('admin'); await deleteGroup(await getDb(), text(group, 100), actorOf(viewer)); refresh(); return { ok: true, message: 'Group deleted. The people in it are kept.' }; } catch (e) { return fail(e); }
}
