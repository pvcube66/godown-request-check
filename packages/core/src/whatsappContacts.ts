import type { Collection } from 'mongodb';
import type { Collections } from './db.js';
import type { AuditDoc } from './masterData.js';
import { hostelLabel } from './hostelName.js';

/** People: the contacts WhatsApp messages go to, and named groups of them. Follows the TeleCRM's People page (contacts with tags, source,
 *  opt-out; groups; import and export), for one business account. One person per phone number, always. */

export interface ContactDoc {
  phone: string;                 // digits with country code, e.g. 919876543210 (unique)
  name: string; email: string; tags: string[]; source: 'manual' | 'import' | 'hostel' | 'inbound'; notes: string;
  optedOut: boolean; optedOutAt: Date | null;
  lastMessagedAt: Date | null;
  createdAt: Date; updatedAt: Date;
}
export interface GroupDoc { name: string; members: string[]; createdAt: Date; updatedAt: Date }
export interface ContactCollections extends Pick<Collections, 'auditLog' | 'hostelsMaster'> { waContacts: Collection<ContactDoc>; waGroups: Collection<GroupDoc> }

export class ContactInputError extends Error {}

/** A phone number as digits with a country code. A 10-digit Indian mobile gets 91; anything else must already have its country code. Null if unusable. */
export function normalizePhone(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/[^0-9]/g, '');
  if (!d) return null;
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) d = `91${d}`;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10) return null;                            // ten digits that are not an Indian mobile have no country code: not guessed
  if (d.length < 8 || d.length > 15 || d.startsWith('0')) return null;
  if (d.startsWith('91') && d.length !== 12) return null;      // an Indian number must be 91 + 10 digits
  return d;
}
export const maskPhone = (p: string) => (p.length > 4 ? `${'•'.repeat(Math.max(0, p.length - 4))}${p.slice(-4)}` : p);
export const tenDigits = (p: string) => p.slice(-10);

const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function cleanTags(v: unknown): string[] {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/[,;|]/);
  return [...new Set(list.map((t) => clean(t, 30).toLowerCase().replace(/\s+/g, '-')).filter(Boolean))].slice(0, 20);
}

export interface ContactInput { phone: string; name?: string; email?: string; tags?: unknown; notes?: string; source?: ContactDoc['source'] }
export function validateContact(i: ContactInput): { phone: string; name: string; email: string; tags: string[]; notes: string } {
  const phone = normalizePhone(i.phone);
  if (!phone) throw new ContactInputError('Enter a phone number with its country code (for example 919876543210, or a 10-digit Indian mobile).');
  const email = clean(i.email, 200).toLowerCase();
  if (email && !EMAIL.test(email)) throw new ContactInputError('That email address does not look right.');
  return { phone, name: clean(i.name, 100), email, tags: cleanTags(i.tags), notes: clean(i.notes, 1000) };
}

const audit = (c: Pick<ContactCollections, 'auditLog'>, actor: string, action: string, target: string, details?: unknown) =>
  c.auditLog.insertOne({ actor, action, target, at: new Date(), ...(details === undefined ? {} : { details }) });

/** Adds a person, or updates the one with the same number (their opt-out is never cleared by an import). */
export async function saveContact(c: ContactCollections, input: ContactInput, actor: string, now = new Date()): Promise<{ created: boolean; contact: ContactDoc }> {
  const v = validateContact(input);
  const prev = await c.waContacts.findOne({ phone: v.phone });
  const doc: ContactDoc = prev
    ? { ...prev, name: v.name || prev.name, email: v.email || prev.email, tags: [...new Set([...prev.tags, ...v.tags])], notes: v.notes || prev.notes, updatedAt: now }
    : { phone: v.phone, name: v.name, email: v.email, tags: v.tags, source: input.source ?? 'manual', notes: v.notes, optedOut: false, optedOutAt: null, lastMessagedAt: null, createdAt: now, updatedAt: now };
  await c.waContacts.updateOne({ phone: v.phone }, { $set: { name: doc.name, email: doc.email, tags: doc.tags, notes: doc.notes, updatedAt: now }, $setOnInsert: { phone: v.phone, source: doc.source, optedOut: false, optedOutAt: null, lastMessagedAt: null, createdAt: now } }, { upsert: true });
  await audit(c, actor, prev ? 'contact.update' : 'contact.create', v.phone);
  return { created: !prev, contact: doc };
}

/** Replaces a person's details exactly as edited (tags and notes can shrink too). */
export async function editContact(c: ContactCollections, phone: string, input: Omit<ContactInput, 'phone'>, actor: string, now = new Date()): Promise<void> {
  const p = normalizePhone(phone);
  if (!p) throw new ContactInputError('Unknown contact.');
  const v = validateContact({ ...input, phone: p });
  const r = await c.waContacts.updateOne({ phone: p }, { $set: { name: v.name, email: v.email, tags: v.tags, notes: v.notes, updatedAt: now } });
  if (!r.matchedCount) throw new ContactInputError('That contact no longer exists.');
  await audit(c, actor, 'contact.edit', p);
}

export async function deleteContacts(c: ContactCollections, phones: string[], actor: string): Promise<number> {
  const list = [...new Set(phones.map(normalizePhone).filter((p): p is string => !!p))];
  if (!list.length || list.length > 1000) throw new ContactInputError('Choose between 1 and 1000 contacts.');
  const r = await c.waContacts.deleteMany({ phone: { $in: list } });
  await c.waGroups.updateMany({}, { $pull: { members: { $in: list } } });
  await audit(c, actor, 'contact.delete', `${r.deletedCount} contact(s)`, { phones: list.slice(0, 50) });
  return r.deletedCount;
}

/** Opt out (or back in) one person. Hostels use the same number for reminders, so the hostel record follows. */
export async function setOptOut(c: ContactCollections, phone: string, optedOut: boolean, actor: string, now = new Date()): Promise<void> {
  const p = normalizePhone(phone);
  if (!p) throw new ContactInputError('Unknown contact.');
  await c.waContacts.updateOne({ phone: p }, { $set: { optedOut, optedOutAt: optedOut ? now : null, updatedAt: now }, $setOnInsert: { phone: p, name: '', email: '', tags: [], source: 'inbound', notes: '', lastMessagedAt: null, createdAt: now } }, { upsert: true });
  await c.hostelsMaster.updateMany({ hostelPhone: tenDigits(p) }, optedOut ? { $set: { whatsappOptOut: true, whatsappOptOutAt: now, updatedAt: now } } : { $set: { whatsappOptOut: false, updatedAt: now } });
  await audit(c, actor, optedOut ? 'contact.opt-out' : 'contact.opt-in', p);
}

// ----- list / counts -----
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export interface ContactQuery { q?: string; tag?: string; group?: string; optedOut?: boolean }
export function contactFilter(q: ContactQuery, groupMembers?: string[]): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  const text = (q.q ?? '').trim().slice(0, 60);
  if (text) { const lit = { $regex: escapeRe(text), $options: 'i' }; const digits = text.replace(/[^0-9]/g, ''); f.$or = [{ name: lit }, { email: lit }, { notes: lit }, ...(digits.length >= 3 ? [{ phone: { $regex: escapeRe(digits) } }] : [])]; }
  if (q.tag) f.tags = q.tag;
  if (groupMembers) f.phone = { $in: groupMembers };
  if (q.optedOut !== undefined) f.optedOut = q.optedOut;
  return f;
}
export async function tagCounts(c: Pick<ContactCollections, 'waContacts'>): Promise<{ tag: string; n: number }[]> {
  return (await c.waContacts.aggregate<{ _id: string; n: number }>([{ $unwind: '$tags' }, { $group: { _id: '$tags', n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 60 }]).toArray()).map((r) => ({ tag: r._id, n: r.n }));
}

// ----- bulk add (import and hostels) -----
export interface ImportRow { phone?: unknown; name?: unknown; email?: unknown; tags?: unknown; notes?: unknown }
export interface ImportResult { added: number; updated: number; skipped: { row: number; reason: string }[]; total: number }

/** Checks every row first. With `commit` false nothing is saved (the preview). Rows with the same number are merged. Existing opt-outs are kept. */
export async function importContacts(c: ContactCollections, rows: readonly ImportRow[], opts: { commit: boolean; tags?: string[]; group?: string; source?: ContactDoc['source'] }, actor: string, now = new Date()): Promise<ImportResult> {
  if (rows.length > 5000) throw new ContactInputError('At most 5000 rows at a time.');
  const seen = new Map<string, ContactInput>();
  const skipped: ImportResult['skipped'] = [];
  rows.forEach((r, i) => {
    try {
      const v = validateContact({ phone: String(r.phone ?? ''), name: r.name as string, email: r.email as string, tags: r.tags, notes: r.notes as string });
      const prev = seen.get(v.phone);
      seen.set(v.phone, prev ? { phone: v.phone, name: v.name || prev.name, email: v.email || prev.email, tags: [...cleanTags(prev.tags), ...v.tags], notes: v.notes || prev.notes } : v);
    } catch (e) { skipped.push({ row: i + 2, reason: e instanceof ContactInputError ? e.message : 'Unreadable row' }); }
  });
  const phones = [...seen.keys()];
  const existing = new Set((await c.waContacts.find({ phone: { $in: phones } }, { projection: { phone: 1 } }).toArray()).map((x) => x.phone));
  const result: ImportResult = { added: phones.filter((p) => !existing.has(p)).length, updated: existing.size, skipped, total: rows.length };
  if (!opts.commit || !phones.length) return result;
  const extra = opts.tags ?? [];
  for (const input of seen.values()) await saveContact(c, { ...input, tags: [...cleanTags(input.tags), ...extra], source: opts.source ?? 'import' }, actor, now);
  if (opts.group) await addToGroup(c, opts.group, phones, actor, now);
  await audit(c, actor, 'contact.import', `${result.added} added, ${result.updated} updated`, { skipped: skipped.length });
  return result;
}

/** Hostels' in-charge numbers from Master data become people, tagged "hostel" and by district. Opted-out hostels stay opted out. */
export async function addHostelContacts(c: ContactCollections, actor: string, now = new Date()): Promise<ImportResult> {
  const hostels = await c.hostelsMaster.find({ hostelPhone: { $exists: true, $ne: '' } }, { projection: { hostelName: 1, districtName: 1, hostelPhone: 1, whatsappOptOut: 1 } }).toArray();
  const rows = hostels.map((h) => ({ phone: h.hostelPhone, name: hostelLabel(h.hostelName), tags: ['hostel', String(h.districtName ?? '').toLowerCase()] }));
  const r = await importContacts(c, rows, { commit: true, source: 'hostel' }, actor, now);
  const out = hostels.filter((h) => h.whatsappOptOut).map((h) => normalizePhone(h.hostelPhone)).filter((p): p is string => !!p);
  if (out.length) await c.waContacts.updateMany({ phone: { $in: out } }, { $set: { optedOut: true, optedOutAt: now } });
  return r;
}

// ----- groups -----
const groupName = (n: string) => { const v = clean(n, 60); if (!v) throw new ContactInputError('Give the group a name.'); return v; };
export async function createGroup(c: ContactCollections, name: string, members: string[], actor: string, now = new Date()): Promise<void> {
  const nm = groupName(name);
  const list = [...new Set(members.map(normalizePhone).filter((p): p is string => !!p))];
  try { await c.waGroups.insertOne({ name: nm, members: list, createdAt: now, updatedAt: now }); }
  catch (e) { if ((e as { code?: number }).code === 11000) throw new ContactInputError('A group with this name already exists.'); throw e; }
  await audit(c, actor, 'group.create', nm, { members: list.length });
}
export async function addToGroup(c: ContactCollections, name: string, phones: string[], actor: string, now = new Date()): Promise<number> {
  const list = [...new Set(phones.map(normalizePhone).filter((p): p is string => !!p))];
  const r = await c.waGroups.updateOne({ name }, { $addToSet: { members: { $each: list } }, $set: { updatedAt: now } });
  if (!r.matchedCount) throw new ContactInputError('That group no longer exists.');
  await audit(c, actor, 'group.add', name, { added: list.length });
  return list.length;
}
export async function removeFromGroup(c: ContactCollections, name: string, phones: string[], actor: string): Promise<void> {
  await c.waGroups.updateOne({ name }, { $pull: { members: { $in: phones } }, $set: { updatedAt: new Date() } });
  await audit(c, actor, 'group.remove', name, { removed: phones.length });
}
export async function deleteGroup(c: ContactCollections, name: string, actor: string): Promise<void> {
  const r = await c.waGroups.deleteOne({ name });
  if (!r.deletedCount) throw new ContactInputError('That group no longer exists.');
  await audit(c, actor, 'group.delete', name);
}

/** Everyone who can be messaged out of a list of numbers: opted-out people are left out (and counted). */
export async function messageable(c: Pick<ContactCollections, 'waContacts'>, phones: string[]): Promise<{ ok: ContactDoc[]; optedOut: number; unknown: number }> {
  const list = [...new Set(phones)];
  const found = await c.waContacts.find({ phone: { $in: list } }).toArray();
  return { ok: found.filter((p) => !p.optedOut), optedOut: found.filter((p) => p.optedOut).length, unknown: list.length - found.length };
}

export const CSV_HEADERS = ['phone', 'name', 'email', 'tags', 'notes'] as const;
