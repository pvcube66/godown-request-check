import assert from 'node:assert/strict';
import { acquireCycleLock, closeDb, ensureDistricts, releaseCycleLock, runCycle } from '../../packages/core/src/index.ts';
import { connectLocal } from './local.mts';

/** Real-MongoDB checks of the hosted hourly check: one at a time across places, and a clean finish even with nothing to read. Local test database only. */
const c = await connectLocal('it_cron');
await c.settings.deleteMany({ _id: 'cycle-lock' } as never); await c.runs.deleteMany({}); await c.accounts.deleteMany({});
let passed = 0; const ok = (n: string) => { passed++; console.log(`PASS  ${n}`); };

const wins = await Promise.all([acquireCycleLock(c), acquireCycleLock(c), acquireCycleLock(c), acquireCycleLock(c)]);
assert.equal(wins.filter(Boolean).length, 1); ok('four starts at the same moment: only one gets the lock');
assert.equal(await acquireCycleLock(c), false); ok('a second start while one is running is refused');
await releaseCycleLock(c);
assert.equal(await acquireCycleLock(c), true); await releaseCycleLock(c); ok('after it finishes, the next one can start');
await c.settings.updateOne({ _id: 'cycle-lock' } as never, { $set: { until: new Date(Date.now() - 1000) } } as never);
assert.equal(await acquireCycleLock(c), true); await releaseCycleLock(c); ok('a lock left behind by a crashed run expires by itself');

const run = await runCycle(c, 'cron-test', 'recent', { budgetMs: 40_000 });
assert.ok(run && run.ok); assert.equal(await c.runs.countDocuments({ trigger: 'cron-test' }), 1); ok('a time-budgeted check finishes and is recorded');
assert.equal(await acquireCycleLock(c), true); await releaseCycleLock(c); ok('and releases the lock');

await c.requests.deleteMany({}); await c.orders.deleteMany({}); await c.districts.deleteMany({});
await c.requests.insertOne({ godownId: 1, requestId: 'R1', districtName: 'Nagarkurnool', hostelCode: 'H1', month: '2026-10' } as never);
assert.equal(await ensureDistricts(c), 1); assert.equal(await ensureDistricts(c), 0); assert.equal((await c.districts.findOne({}))!.name, 'Nagarkurnool'); ok('a new district found in the data is saved once');

console.log(`\n${passed} checks passed`);
await closeDb(); process.exit(0);
