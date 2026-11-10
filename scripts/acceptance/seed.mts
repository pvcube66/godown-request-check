import { closeDb, createUser, ensureWhatsAppSettings, normalizedDistrictCode, raiseIssue, syncIssues } from '../../packages/core/src/index.ts';
import { connectLocal } from './local.mts';

/** Fills a local test database with a small, made-up world: two districts, six hostels, orders at every stage, flags, an issue,
 *  suppliers, supplied quantities, WhatsApp history and four logins. Nothing here is real data.
 *  Usage: npx tsx scripts/acceptance/seed.ts [dbName]   (default it_accept) */
const dbName = process.argv[2] ?? 'it_accept';
const c = await connectLocal(dbName);
const now = new Date();
const day = (n: number) => new Date(now.getTime() - n * 86_400_000);

for (const x of [c.users, c.districts, c.orders, c.anomalies, c.requests, c.auditLog, c.issues, c.remarks, c.hostels, c.runs, c.hostelsMaster, c.godowns, c.suppliers, c.mappings, c.itemsMaster, c.settings, c.accounts, c.whatsappMessages]) await x.deleteMany({});

const DISTRICTS = { A: 'Nalgonda', B: 'Warangal' } as const;
for (const n of Object.values(DISTRICTS)) await c.districts.insertOne({ code: normalizedDistrictCode(n), name: n, createdAt: now, updatedAt: now });
await c.accounts.insertOne({ username: 'GDN-TEST', passwordEnc: 'x', godowns: [{ id: 1, name: 'TEST GODOWN' }], status: 'active', createdAt: now } as never);
await c.godowns.insertOne({ godownId: 1, portalLogin: 'GDN-TEST', name: 'TEST GODOWN', status: 'active', createdAt: now, updatedAt: now });
await c.suppliers.insertMany([{ code: 'S1', name: 'Test Supplier One', createdAt: now, updatedAt: now }, { code: 'S2', name: 'Test Supplier Two', createdAt: now, updatedAt: now }]);
await c.mappings.insertMany([
  { districtCode: normalizedDistrictCode('Nalgonda'), godownId: 1, supplierCode: 'S1', from: '2026-01-01', to: null, createdAt: now, changedBy: 'seed' },
  { districtCode: normalizedDistrictCode('Warangal'), godownId: 1, supplierCode: 'S2', from: '2026-01-01', to: null, createdAt: now, changedBy: 'seed' },
]);

const STAGES = ['pending', 'dc', 'transit', 'received', 'variation', 'rejected', 'cancelled'] as const;
let n = 0;
for (const [d, name] of Object.entries(DISTRICTS)) for (let h = 1; h <= 3; h++) {
  const code = `${d}${h}`; const hostelName = `3626050100${h}-KGBV TEST ${name.toUpperCase()} ${h}`;
  await c.hostelsMaster.insertOne({ godownId: 1, hostelCode: code, hostelName, districtName: name, districtCode: normalizedDistrictCode(name), hostelPhone: `98765000${d === 'A' ? 1 : 2}${h}`, createdAt: now, updatedAt: now });
  await c.requests.insertOne({ godownId: 1, requestId: `IR-${code}`, societyId: 's', hostelCode: code, hostelName, districtName: name, godownName: 'TEST', requestDate: '2026-11-01', month: '2026-12', status: 'Pending', dcNumber: null, items: { Sugar: 300, Rice: 500 }, firstSeenAt: day(10), updatedAt: day(1) } as never);
  await c.anomalies.insertOne({ key: `1|${code}|2026-12|Sugar`, godownId: 1, hostelCode: code, hostelName, districtName: name, month: '2026-12', item: 'Sugar', requested: 300, expected: 30, ratio: 10, score: 9, severity: 'high', method: 'own-history', kind: 'spike', reason: 'x', status: 'open', detectedAt: now, updatedAt: now, lastSeenAt: now } as never);
  for (const stage of STAGES) {
    n++; const since = day(2 + (n % 20));
    const supplied = ['dc', 'transit', 'received', 'variation'].includes(stage);
    await c.orders.insertOne({
      account: 'GDN-TEST', requestId: `S-${code}-${stage}`, hostelCode: code, hostelName, districtName: name, monthName: 'December', academicYear: '2026-27', placedOn: day(25), rawStatus: stage, stage, stageSince: since,
      stages: [{ stage, since, source: stage === 'rejected' || stage === 'cancelled' ? 'observed' : 'portal' }],
      reached: { pending: day(25), dc: supplied ? day(22) : null, transit: ['transit', 'received'].includes(stage) ? day(21) : null, received: stage === 'received' ? since : null },
      dcNumber: null, vehicleNo: null, firstSeenAt: day(25), lastSeenAt: now,
      ...(supplied ? { fulfilment: { stage, readAt: now, lines: 4, linesWithSupply: 4, fullLines: d === 'A' ? 4 : 2, lineFill: d === 'A' ? 1 : 0.7, receivedFill: stage === 'received' ? 0.9 : null, variationLines: stage === 'variation' ? 1 : 0, short: d === 'A' ? [] : [{ name: 'Sugar', unit: 'Kg', requested: 50, supplied: 20 }] } } : {}),
    } as never);
  }
}
await c.runs.insertOne({ startedAt: now, finishedAt: now, ok: true, trigger: 'seed', accounts: [], newAnomalies: 0 } as never);

const code = normalizedDistrictCode;
await createUser(c, { name: 'Test Admin', phone: '', email: 'admin@test.example', role: 'admin', districts: [], password: 'admin-password-1' }, 'seed');
await createUser(c, { name: 'Test Operator', phone: '', email: 'operator@test.example', role: 'operator', districts: [code('Nalgonda')], password: 'operator-pass-1' }, 'seed');
await createUser(c, { name: 'Test Viewer', phone: '', email: 'viewer@test.example', role: 'viewer', districts: [code('Nalgonda')], password: 'viewer-pass-12' }, 'seed');
await createUser(c, { name: 'Test Other Operator', phone: '', email: 'other@test.example', role: 'operator', districts: [code('Warangal')], password: 'other-pass-123' }, 'seed');

// One issue in each district: Nalgonda's is overdue (rejected on the portal 4 days ago, no new indent).
for (const h of ['A1', 'B1']) {
  const a = (await c.anomalies.findOne({ hostelCode: h }))!;
  await raiseIssue(c, { reason: `Sugar typed wrong at ${h}`, anomalies: [a], actor: 'user:seed', actorName: 'Seed Person' }, day(5));
}
await c.requests.updateOne({ hostelCode: 'A1' }, { $set: { status: 'Rejected' } });
await syncIssues(c, day(4));

await ensureWhatsAppSettings(c);
const transit = (await c.orders.findOne({ stage: 'transit', districtName: 'Nalgonda' }))!;
await c.whatsappMessages.insertMany([
  { sendKey: 'seed|1', messageId: 'wamid.seed1', direction: 'out', requestId: transit.requestId, hostelCode: transit.hostelCode, hostelName: transit.hostelName, districtName: 'Nalgonda', phoneLast4: '0011', template: 'order_not_acknowledged', reminderNo: 1, text: 't', status: 'read', counted: true, createdAt: day(1), statusAt: now },
  { messageId: 'in-seed', direction: 'in', requestId: transit.requestId, hostelCode: transit.hostelCode, hostelName: transit.hostelName, districtName: 'Nalgonda', phoneLast4: '0011', text: 'Acknowledged sir', status: 'received', counted: false, createdAt: now, statusAt: now },
] as never);

console.log(`Seeded ${await c.orders.countDocuments()} orders, ${await c.hostelsMaster.countDocuments()} hostels, ${await c.users.countDocuments()} logins into ${dbName}.`);
await closeDb();
