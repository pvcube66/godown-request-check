import { closeDb, getWhatsAppSettings, normalizedDistrictCode, planReminders, scoped } from '../../packages/core/src/index.ts';
import { loadSummaryOrders, stageSummary, summarize } from '../../apps/web/src/lib/dashboard.ts';
import { loadPerfOrders, performance } from '../../apps/web/src/lib/performance.ts';
import { loadOrders, stageCounts } from '../../apps/web/src/lib/orders.ts';
import { connectLocal } from './local.mts';

/** Load check on made-up data: 18 godowns, 33 districts, ~1,800 hostels, ~25,000 orders (about a year at 2,000+ a month).
 *  Usage: npx tsx scripts/acceptance/load-check.mts   (uses the local database it_load) */
const c = await connectLocal('it_load');
const N = Number(process.argv[2] ?? 25_000);
const now = new Date();
for (const x of [c.orders, c.hostelsMaster, c.godowns, c.whatsappMessages, c.settings, c.accounts, c.suppliers, c.mappings]) await x.deleteMany({});
const STAGES = ['pending', 'dc', 'transit', 'received', 'received', 'received', 'variation', 'rejected', 'cancelled'] as const;
const day = (n: number) => new Date(now.getTime() - n * 86_400_000);
const hostels = Array.from({ length: 1800 }, (_, i) => ({ code: `H${i}`, district: `District ${i % 33}`, godown: i % 18 }));
await c.godowns.insertMany(Array.from({ length: 18 }, (_, g) => ({ godownId: g + 1, portalLogin: `GDN-${g}`, name: `Godown ${g}`, status: 'active', createdAt: now, updatedAt: now })) as never);
await c.accounts.insertMany(Array.from({ length: 18 }, (_, g) => ({ username: `GDN-${g}`, passwordEnc: 'x', godowns: [{ id: g + 1, name: `Godown ${g}` }], status: 'active', createdAt: now })) as never);
await c.hostelsMaster.insertMany(hostels.map((h) => ({ godownId: h.godown + 1, hostelCode: h.code, hostelName: `36260${h.code}-KGBV ${h.code}`, districtName: h.district, districtCode: normalizedDistrictCode(h.district), hostelPhone: `98${String(10_000_000 + Number(h.code.slice(1))).slice(0, 8)}`, createdAt: now, updatedAt: now })) as never);
const docs = Array.from({ length: N }, (_, i) => {
  const h = hostels[i % hostels.length]!; const stage = STAGES[i % STAGES.length]!; const age = 1 + (i * 7) % 300; const since = day(age);
  const supplied = ['dc', 'transit', 'received', 'variation'].includes(stage);
  return { account: `GDN-${h.godown}`, requestId: `IR${100000 + i}`, hostelCode: h.code, hostelName: `36260${h.code}-KGBV ${h.code}`, districtName: h.district, monthName: 'X', academicYear: '2026-27', placedOn: day(age + 4), rawStatus: stage, stage, stageSince: since, stages: [{ stage, since, source: 'portal' }], reached: { pending: day(age + 4), dc: supplied ? day(age + 2) : null, transit: ['transit', 'received'].includes(stage) ? day(age + 1) : null, received: stage === 'received' ? since : null }, firstSeenAt: since, lastSeenAt: now, ...(supplied ? { fulfilment: { stage, readAt: now, lines: 20, linesWithSupply: 20, fullLines: 15, lineFill: 0.8 + (i % 20) / 100, receivedFill: 0.95, variationLines: 0, short: [] } } : {}) };
});
for (let i = 0; i < docs.length; i += 5000) await c.orders.insertMany(docs.slice(i, i + 5000) as never);

const timings: [string, number][] = [];
async function time<T>(name: string, f: () => Promise<T> | T): Promise<T> { const t = Date.now(); const r = await f(); timings.push([name, Date.now() - t]); return r; }
const all = await time('dashboard: load every order (4 fields)', () => loadSummaryOrders(c, null));
await time('dashboard: by district + by godown + by stage', () => { summarize(all, 'district', now); summarize(all, 'godown', now); stageSummary(all, now); });
await time('dashboard as an operator with 3 districts', async () => summarize(await loadSummaryOrders(c, ['District 1', 'District 2', 'District 3']), 'district', now));
const perf = await time('supplier performance: load', () => loadPerfOrders(c, null));
await time('supplier performance: by hostel (1,800 rows)', () => performance(perf, 'hostel', now, { supplier: () => ({ key: 'S', label: 'S' }), godown: (a) => a }));
await time('order tracking: first page (sorted, filtered to stage)', async () => (await loadOrders(c, { stage: 'transit' }, null, 0, now)).length);
await time('order tracking: stage counts', () => stageCounts(c, null));
await time('order tracking: stuck 15+ days list', async () => (await loadOrders(c, { stuck: '15' }, null, 0, now)).length);
const st = await getWhatsAppSettings(c);
const plan = await time('WhatsApp: work out who is due', () => planReminders(c, st, now));
await time('orders for one district (operator view)', async () => (await c.orders.find(scoped({}, ['District 5'])).toArray()).length);
console.log(`Orders: ${N}. In transit: ${plan.transit}. Due now: ${plan.items.length}.\n`);
for (const [n, ms] of timings) console.log(`${String(ms).padStart(6)} ms  ${n}`);
const slow = timings.filter(([, ms]) => ms > 5000);
console.log(slow.length ? `\nSLOW (over 5 s): ${slow.map(([n]) => n).join('; ')}` : '\nEvery step finished in under 5 seconds.');
await closeDb(); process.exit(slow.length ? 1 : 0);
