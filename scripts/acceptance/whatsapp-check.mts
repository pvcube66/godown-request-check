import assert from 'node:assert/strict';
import { addHostelContacts, addToGroup, closeDb, createGroup, deleteContacts, deleteGroup, editContact, importContacts, messageable, removeFromGroup, saveContact, setOptOut, tagCounts } from '../../packages/core/src/index.ts';
import { MAX_PER_HOUR, tidyMessages, waStats, addQuickReply, deleteQuickReply, campaignStats, changeCampaign, createCampaign, reviewCampaign, retryFailed, runCampaignBatch, runCampaigns, conversationFilter, markRead, processWebhook, sealSecret, sendMessages, setConversationStatus } from '../../packages/core/src/index.ts';
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

// ---- Send Message (fake Meta, real database)
for (const x of [c.waContacts, c.waGroups, c.whatsappMessages, c.waTemplates]) await x.deleteMany({});
await saveContact(c, { phone: '9876543210', name: 'Ravi Kumar' }, 'u1'); await saveContact(c, { phone: '9876543211', name: 'Sita' }, 'u1'); await saveContact(c, { phone: '9876543212', name: 'Out' }, 'u1');
await setOptOut(c, '919876543212', true, 'u1');
await c.waTemplates.insertOne({ name: 'hello', language: 'en', category: 'UTILITY', status: 'APPROVED', form: null, components: [], bodyText: 'Hi {{1}}, order {{2}} is ready.', variables: 2, metaId: 'm', reason: null, createdAt: now, updatedAt: now, syncedAt: now });
await c.settings.updateOne({ _id: 'whatsapp' }, { $set: { value: { mode: 'live', phoneNumberId: '123456', wabaId: '654321', accessTokenEnc: sealSecret('t'), appSecretEnc: sealSecret('s'), templateStatus: 'APPROVED' } } }, { upsert: true });
const sent: { to: string }[] = [];
const meta = (async (_u: string, init: { body: string }) => { const b = JSON.parse(init.body); sent.push(b); return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.real${sent.length}` }] }) }; }) as unknown as typeof fetch;
const req = { kind: 'template' as const, template: { name: 'hello', language: 'en' }, body: ['{name}', 'A1'], phones: ['919876543210', '919876543212'], batchId: 'batch-1' };
const pv = await sendMessages(c, req, { preview: true, actor: 'u1' }, meta);
assert.equal(sent.length, 0); assert.equal(await c.whatsappMessages.countDocuments(), 0); assert.equal(pv.results.find((r) => r.phone === '919876543212')!.outcome, 'opted_out'); ok('preview sends and stores nothing; the opted-out person is skipped');
const go = await sendMessages(c, req, { preview: false, actor: 'u1' }, meta);
assert.equal(go.sent, 1); assert.equal(sent.length, 1); assert.equal(sent[0]!.to, '919876543210');
assert.equal((await c.whatsappMessages.findOne({ phone: '919876543210' }))!.status, 'sent'); ok('live send reaches only the allowed person and is recorded');
await sendMessages(c, req, { preview: false, actor: 'u1' }, meta);
assert.equal(sent.length, 1); assert.equal(await c.whatsappMessages.countDocuments({ phone: '919876543210' }), 1); ok('sending the same batch twice (double click) still sends once');
assert.ok((await c.waContacts.findOne({ phone: '919876543210' }))!.lastMessagedAt); ok('the contact remembers when it was last messaged');

// ---- Chats: inbound webhook, conversations, 24-hour window
await c.waConversations.deleteMany({});
const hook = (id: string, from: string, text: string, pn = '123456') => ({ entry: [{ changes: [{ value: { metadata: { phone_number_id: pn }, contacts: [{ wa_id: from, profile: { name: 'Meena' } }], messages: [{ id, from, type: 'text', text: { body: text } }] } }] }] });
const st = { phoneNumberId: '123456' };
await processWebhook(c, hook('wamid.in1', '919000011111', 'Hello, is my order coming?'), st, now);
const ct = await c.waContacts.findOne({ phone: '919000011111' });
assert.equal(ct!.source, 'inbound'); assert.equal(ct!.name, 'Meena'); ok('a message from an unknown number creates a person');
let conv = await c.waConversations.findOne({ phone: '919000011111' });
assert.equal(conv!.unread, 1); assert.equal(conv!.status, 'open'); assert.ok(conv!.lastInboundAt); ok('and a chat with one unread message');
await processWebhook(c, hook('wamid.in1', '919000011111', 'Hello, is my order coming?'), st, now);
assert.equal((await c.waConversations.findOne({ phone: '919000011111' }))!.unread, 1); assert.equal(await c.whatsappMessages.countDocuments({ messageId: 'wamid.in1' }), 1); ok('Meta sending the same message twice counts once');
await processWebhook(c, hook('wamid.in2', '919000022222', 'hi', '999999'), st, now);
assert.equal(await c.waContacts.countDocuments({ phone: '919000022222' }), 0); ok('events for another phone number are ignored');
await markRead(c, '919000011111'); assert.equal((await c.waConversations.findOne({ phone: '919000011111' }))!.unread, 0); ok('opening a chat clears unread');
await setConversationStatus(c, '919000011111', 'closed');
await processWebhook(c, hook('wamid.in3', '919000011111', 'Any update?'), st, now);
conv = await c.waConversations.findOne({ phone: '919000011111' }); assert.equal(conv!.status, 'open'); assert.equal(conv!.unread, 1); ok('a new reply reopens a closed chat');
const sent2: { type: string }[] = [];
const meta2 = (async (_u: string, init: { body: string }) => { sent2.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.t${sent2.length}` }] }) }; }) as unknown as typeof fetch;
const inWin = await sendMessages(c, { kind: 'text', text: 'Yes, tomorrow.', phones: ['919000011111'] }, { preview: false, actor: 'u1' }, meta2);
assert.equal(inWin.sent, 1); assert.equal(sent2[0]!.type, 'text'); ok('a text reply inside 24 hours is sent');
assert.equal((await c.waConversations.findOne({ phone: '919000011111' }))!.lastDirection, 'out'); ok('and shows as the latest message of the chat');
await c.whatsappMessages.updateMany({ phone: '919000011111', direction: 'in' }, { $set: { createdAt: new Date(Date.now() - 30 * 3600_000) } });
const outWin = await sendMessages(c, { kind: 'text', text: 'Late reply', phones: ['919000011111'] }, { preview: false, actor: 'u1' }, meta2);
assert.equal(outWin.results[0]!.outcome, 'outside_window'); assert.equal(sent2.length, 1); ok('a text reply after 24 hours is refused');
await processWebhook(c, hook('wamid.in4', '919000011111', 'STOP'), st, now);
assert.equal((await c.waContacts.findOne({ phone: '919000011111' }))!.optedOut, true); ok('STOP opts the person out');
const afterStop = await sendMessages(c, { kind: 'template', template: { name: 'hello', language: 'en' }, body: ['x', 'y'], phones: ['919000011111'] }, { preview: false, actor: 'u1' }, meta2);
assert.equal(afterStop.results[0]!.outcome, 'opted_out'); ok('and they are never messaged again');
assert.equal(await c.waConversations.countDocuments(conversationFilter({ filter: 'unread' })), 1); assert.equal(await c.waConversations.countDocuments(conversationFilter({ q: '.*' })), 0); ok('chat list filters work and search is literal');

// ---- Campaigns
for (const x of [c.waCampaigns, c.waCampaignRecipients]) await x.deleteMany({});
await c.waContacts.deleteMany({}); await c.whatsappMessages.deleteMany({}); await c.waGroups.deleteMany({});
for (let i = 0; i < 45; i++) await saveContact(c, { phone: `9900000${String(i).padStart(3, '0')}`, name: `Person ${i}`, tags: i % 2 ? 'odd,all' : 'even,all' }, 'u1');
await setOptOut(c, '919900000003', true, 'u1'); await setOptOut(c, '919900000004', true, 'u1');
const input = { name: 'Diwali note', template: { name: 'hello', language: 'en' }, body: ['{name}', 'B7'], header: [] as string[], audience: { tags: ['all'] } };
const rv = await reviewCampaign(c, input);
assert.deepEqual([rv.people, rv.optedOut, rv.will], [45, 2, 43]); assert.match(rv.sample, /Hi Person, order B7/); ok('review counts people and opted-out, and shows a sample');
assert.equal(await c.waCampaigns.countDocuments(), 0); ok('a review saves nothing');
await assert.rejects(createCampaign(c, { ...input, audience: {} }, 'u1'), /Choose who/); await assert.rejects(createCampaign(c, { ...input, body: ['x'] }, 'u1'), /Fill in all 2/); ok('bad campaigns are refused');
const camp = await createCampaign(c, input, 'u1');
assert.equal(camp.total, 43); assert.equal(camp.skippedOptOut, 2); assert.equal(await c.waCampaignRecipients.countDocuments({ campaignId: camp.campaignId }), 43); ok('creating a campaign queues only people who can be messaged');
const sentC: string[] = [];
const metaC = (async (_u: string, init: { body: string }) => { const b = JSON.parse(init.body); sentC.push(b.to); return b.to === '919900000010' ? { ok: false, status: 400, json: async () => ({ error: { code: 131026, message: 'Message undeliverable' } }) } : { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.c${sentC.length}` }] }) }; }) as unknown as typeof fetch;
assert.equal((await runCampaignBatch(c, camp.campaignId, metaC)).state, 'idle'); assert.equal(sentC.length, 0); ok('a campaign that was not started sends nothing');
await changeCampaign(c, camp.campaignId, 'start', 'u1');
const b1 = await runCampaignBatch(c, camp.campaignId, metaC);
assert.equal(b1.processed, 20); assert.equal(sentC.length, 20); ok('the first batch sends 20');
await changeCampaign(c, camp.campaignId, 'pause', 'u1');
assert.equal((await runCampaignBatch(c, camp.campaignId, metaC)).state, 'paused'); assert.equal(sentC.length, 20); ok('pausing stops sending');
await setOptOut(c, '919900000030', true, 'u1');
await changeCampaign(c, camp.campaignId, 'resume', 'u1');
await Promise.all([runCampaignBatch(c, camp.campaignId, metaC), runCampaignBatch(c, camp.campaignId, metaC)]);
assert.equal(new Set(sentC).size, sentC.length); ok('two workers at once never send to the same person twice');
await runCampaigns(c, metaC);
assert.ok(!sentC.includes('919900000030')); ok('someone who opts out mid-campaign is not messaged');
const fin = await c.waCampaigns.findOne({ campaignId: camp.campaignId });
assert.equal(fin!.status, 'done'); ok('the campaign finishes by itself');
const cs = await campaignStats(c, camp.campaignId);
assert.equal(cs.queued, 0); assert.equal(cs.sent + cs.failed, fin!.total); assert.equal(cs.cancelled, 1); ok('totals add up');
assert.equal(cs.failed, 1); assert.equal(await retryFailed(c, camp.campaignId, 'u1'), 1);
assert.equal((await c.waCampaigns.findOne({ campaignId: camp.campaignId }))!.status, 'running'); ok('failed people can be retried');
await c.whatsappMessages.updateOne({ phone: '919900000000', campaignId: camp.campaignId }, { $set: { status: 'read' } });
assert.equal((await campaignStats(c, camp.campaignId)).read, 1); ok('read ticks show up in the campaign stats');
const c2 = await createCampaign(c, { ...input, name: 'Second' }, 'u1');
await c.settings.updateOne({ _id: 'whatsapp' }, { $set: { 'value.mode': 'dry_run' } });
const before = sentC.length;
await changeCampaign(c, c2.campaignId, 'start', 'u1'); await runCampaigns(c, metaC);
const pr = await c.waCampaigns.findOne({ campaignId: c2.campaignId });
assert.equal(sentC.length, before); assert.equal(pr!.dryRun, true); assert.ok((await campaignStats(c, c2.campaignId)).previewed > 0); ok('in preview mode the whole flow runs and nothing is sent');
assert.equal(pr!.status, 'done'); await assert.rejects(changeCampaign(c, c2.campaignId, 'cancel', 'u1'), /cannot be cancelled/);
const c3 = await createCampaign(c, { ...input, name: 'Third' }, 'u1');
await changeCampaign(c, c3.campaignId, 'start', 'u1'); await changeCampaign(c, c3.campaignId, 'cancel', 'u1');
assert.equal(await c.waCampaignRecipients.countDocuments({ campaignId: c3.campaignId, status: 'queued' }), 0); ok('cancelling stops everyone still waiting');
await c.settings.updateOne({ _id: 'whatsapp' }, { $set: { 'value.mode': 'live' } });

// ---- Quick replies
await c.waQuickReplies.deleteMany({});
await addQuickReply(c, 'Thanks', 'Thank you, noted.', 'u1');
await assert.rejects(addQuickReply(c, 'Thanks', 'again', 'u1'), /already exists/); ok('quick replies: a title can only exist once (enforced by the database)');
await deleteQuickReply(c, 'Thanks', 'u1'); assert.equal(await c.waQuickReplies.countDocuments(), 0); ok('quick replies can be deleted');

// ---- Stats, housekeeping, hourly limit
await c.whatsappMessages.deleteMany({});
const nowS = new Date(); const old = (d: number) => new Date(nowS.getTime() - d * 86400_000);
const mk = (over: object) => ({ messageId: null, direction: 'out', requestId: null, hostelCode: '', hostelName: '', districtName: '', phoneLast4: '1111', phone: '919000099999', kind: 'single', text: 'x', counted: false, createdAt: nowS, statusAt: nowS, ...over });
await c.whatsappMessages.insertMany([mk({ status: 'read', template: 'hello', messageId: 'a1' }), mk({ status: 'delivered', template: 'hello', messageId: 'a2' }), mk({ status: 'sent', template: 'other', messageId: 'a3' }), mk({ status: 'failed', template: 'hello', errorText: '131026: Message undeliverable', messageId: 'a4' }), mk({ status: 'failed', template: 'hello', errorText: '190: token', messageId: 'a5' }), mk({ direction: 'in', status: 'received', messageId: 'a6' })] as never);
const sx = await waStats(c, 14);
assert.deepEqual([sx.sent, sx.delivered, sx.read, sx.failed, sx.replies], [5, 2, 1, 2, 1]); assert.equal(sx.byTemplate.find((t) => t.template === 'hello')!.sent, 4); assert.equal(sx.failures.length, 2); assert.ok(sx.failures.every((f) => f.title && f.action)); assert.equal(sx.byDay.length, 1); ok('stats count sent, delivered, read, failed and replies, by day and template, with plain-English failure reasons');
await c.whatsappMessages.insertMany([mk({ status: 'queued', createdAt: new Date(nowS.getTime() - 40 * 60_000), sendKey: 'stale|1' }), mk({ status: 'sent', createdAt: old(400), messageId: 'old1' }), mk({ status: 'sent', createdAt: old(400), kind: 'reminder', messageId: 'old2' })] as never);
const tid = await tidyMessages(c, nowS);
assert.equal(tid.closed, 1); assert.equal(tid.removed, 1); assert.ok(await c.whatsappMessages.findOne({ messageId: 'old2' })); assert.equal(await c.whatsappMessages.countDocuments({ messageId: 'old1' }), 0); ok('stuck "sending" messages are closed, year-old chats removed, reminder records kept');
await c.whatsappMessages.deleteMany({});
await c.whatsappMessages.insertMany(Array.from({ length: MAX_PER_HOUR }, (_, i) => mk({ status: 'sent', messageId: `h${i}` })) as never);
await assert.rejects(sendMessages(c, { kind: 'text', text: 'x', phones: ['919000011111'] }, { preview: false, actor: 'u1' }, meta2), /an hour/); ok('Send Message refuses to go past the hourly limit');
await c.whatsappMessages.deleteMany({});

console.log(`\n${passed} checks passed`);
await closeDb(); process.exit(0);
