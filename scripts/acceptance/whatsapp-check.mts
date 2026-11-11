import assert from 'node:assert/strict';
import { addHostelContacts, addToGroup, closeDb, createGroup, deleteContacts, deleteGroup, editContact, importContacts, messageable, removeFromGroup, saveContact, setOptOut, tagCounts } from '../../packages/core/src/index.ts';
import { connectLocal } from './local.mts';

/** Real-MongoDB checks of the WhatsApp CRM core (People so far; later phases add to this file). Local test database only (it_wa_crm). */
const c = await connectLocal('it_wa_crm');
for (const x of [c.waContacts, c.waGroups, c.hostelsMaster, c.auditLog]) await x.deleteMany({});
const now = new Date();
let passed = 0; const ok = (name: string) => { passed++; console.log(`PASS  ${name}`); };

// ---- People
const a = await saveContact(c, { phone: '98765 43210', name: 'Ravi', tags: 'hostel,nalgonda' }, 'u1');
assert.equal(a.created, true); ok('adds a person with a cleaned number');
const b = await saveContact(c, { phone: '+91 9876543210', name: '', tags: 'warden', notes: 'night shift' }, 'u1');
assert.equal(b.created, false);
const only = await c.waContacts.find({}).toArray();
assert.equal(only.length, 1); assert.deepEqual(only[0]!.tags.sort(), ['hostel', 'nalgonda', 'warden']); assert.equal(only[0]!.name, 'Ravi'); ok('the same number in another format is the same person (merged, nothing lost)');
await assert.rejects(c.waContacts.insertOne({ ...only[0]!, _id: undefined } as never), /E11000/); ok('the database itself refuses a duplicate number');

await editContact(c, '919876543210', { name: 'Ravi K', tags: ['hostel'], notes: '' }, 'u1');
assert.deepEqual((await c.waContacts.findOne({ phone: '919876543210' }))!.tags, ['hostel']); ok('editing can remove tags and notes');
await assert.rejects(editContact(c, '919999999999', { name: 'x' }, 'u1'), /no longer exists/); ok('editing a missing person says so');

// ---- import: preview saves nothing, commit saves only good rows, opt-outs survive
await setOptOut(c, '919876543210', true, 'u1');
const rows = [{ phone: '9876543210', name: 'Ravi again' }, { phone: '9123456780', name: 'Sita', tags: 'new' }, { phone: '9123456780', email: 'sita@x.com' }, { phone: 'abc' }, { phone: '12345' }, { phone: '9000011111', email: 'bad' }];
const preview = await importContacts(c, rows, { commit: false }, 'u1');
assert.deepEqual([preview.added, preview.updated, preview.skipped.length, preview.total], [1, 1, 3, 6]);
assert.equal(await c.waContacts.countDocuments(), 1); ok('import preview counts but saves nothing');
const done = await importContacts(c, rows, { commit: true, tags: ['batch1'], group: undefined, source: 'import' }, 'u1');
assert.equal(done.added, 1);
const sita = (await c.waContacts.findOne({ phone: '919123456780' }))!;
assert.deepEqual([sita.email, sita.tags.sort(), sita.source], ['sita@x.com', ['batch1', 'new'], 'import']); ok('import saves good rows, merges repeated numbers, adds the batch tag');
assert.equal((await c.waContacts.findOne({ phone: '919876543210' }))!.optedOut, true); ok('an import never clears an opt-out');
assert.deepEqual(done.skipped.map((s) => s.row).sort(), [5, 6, 7]); ok('skipped rows are named by their sheet row number');

// ---- groups
await createGroup(c, 'Nalgonda wardens', ['919876543210', '919123456780'], 'u1');
await assert.rejects(createGroup(c, 'Nalgonda wardens', [], 'u1'), /already exists/); ok('group names are unique');
assert.equal(await addToGroup(c, 'Nalgonda wardens', ['abc', '919123456780'], 'u1'), 1);
assert.deepEqual((await c.waGroups.findOne({ name: 'Nalgonda wardens' }))!.members.sort(), ['919123456780', '919876543210']); ok('adding to a group ignores bad and repeated numbers');
await removeFromGroup(c, 'Nalgonda wardens', ['919123456780'], 'u1');
assert.deepEqual((await c.waGroups.findOne({ name: 'Nalgonda wardens' }))!.members, ['919876543210']); ok('removing from a group');

// ---- who can be messaged
const m = await messageable(c, ['919876543210', '919123456780', '911111111111']);
assert.deepEqual([m.ok.length, m.optedOut, m.unknown], [1, 1, 1]); ok('opted-out people are left out and counted');

// ---- hostels become people; opt-outs follow
const hm = (code: string, phone: string, extra = {}) => ({ godownId: 1, hostelCode: code, hostelName: `3626010-KGBV ${code}`, districtName: 'Nalgonda', districtCode: 'D', hostelPhone: phone, createdAt: now, updatedAt: now, ...extra } as never);
await c.hostelsMaster.insertMany([hm('H1', '9876500001'), hm('H2', '9876500002', { whatsappOptOut: true }), hm('H3', '')]);
const hostels = await addHostelContacts(c, 'u1');
assert.equal(hostels.added, 2);
const h2 = (await c.waContacts.findOne({ phone: '919876500002' }))!;
assert.deepEqual([h2.optedOut, h2.tags.sort(), h2.source, h2.name], [true, ['hostel', 'nalgonda'], 'hostel', 'KGBV H2']); ok('hostel numbers become tagged people, and a hostel that opted out stays opted out');
await setOptOut(c, '919876500001', true, 'u1');
assert.equal((await c.hostelsMaster.findOne({ hostelCode: 'H1' }))!.whatsappOptOut, true);
await setOptOut(c, '919876500001', false, 'u1');
assert.equal((await c.hostelsMaster.findOne({ hostelCode: 'H1' }))!.whatsappOptOut, false); ok('opting a person out or in also updates the hostel record used by reminders');

// ---- tags, delete
const tags = await tagCounts(c);
assert.ok(tags.find((t) => t.tag === 'hostel')!.n >= 2); ok('tag counts');
assert.equal(await deleteContacts(c, ['919123456780', '919876500002'], 'u1'), 2);
assert.equal((await c.waGroups.findOne({ name: 'Nalgonda wardens' }))!.members.includes('919123456780'), false); ok('deleting people also removes them from groups');
await assert.rejects(deleteContacts(c, [], 'u1'), /between 1 and 1000/); ok('delete needs a sensible selection');
await deleteGroup(c, 'Nalgonda wardens', 'u1');
await assert.rejects(deleteGroup(c, 'Nalgonda wardens', 'u1'), /no longer exists/); ok('deleting a group');
assert.ok(await c.auditLog.countDocuments({ action: /^contact\.|^group\./ }) > 10); ok('everything is in the audit log');

console.log(`\n${passed} checks passed`);
await closeDb(); process.exit(0);
