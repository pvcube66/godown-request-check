import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { runBench } from './bench.js';
import { runSweep } from './sweep.js';
import { DEFAULT_CONFIG, detectAnomalies, stableItemName, addAccount, closeDb, connectDb, fetchAttendanceRows, fetchRequestItems, getToken, reviewStats, runCycle, runDetection, syncAll } from '@anomaly/core';

// Load the repo-root .env regardless of where the command is run from.
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const [cmd, ...args] = process.argv.slice(2);

async function main() {
  const c = await connectDb();
  try {
    switch (cmd) {
      case 'add-account': {
        const username = args[0];
        const password = process.env.ACCT_PASSWORD;          // never passed on the command line
        if (!username || !password) throw new Error('Usage: ACCT_PASSWORD=... cli add-account <username>');
        console.log(await addAccount(c, username, password));
        break;
      }
      case 'backfill':
      case 'sync': {
        const run = await syncAll(c, cmd === 'backfill' ? 'backfill' : 'recent', cmd);
        await c.runs.insertOne(run);
        console.log(JSON.stringify(run, null, 2));
        if (!run.ok) process.exitCode = 1;
        break;
      }
      case 'cycle': {                      // one full sync + detection pass, then exit
        const run = await runCycle(c, 'manual');
        console.log(JSON.stringify(run, null, 2));
        if (run && !run.ok) process.exitCode = 1;
        break;
      }
      case 'serve': {                      // long-running: every hour on the hour (India time)
        const tick = async (why: string) => {
          const run = await runCycle(c, why);
          const log = run ? `ok=${run.ok} newAnomalies=${run.newAnomalies ?? 0} accounts=${run.accounts.map((a) => `${a.username}:${a.ok ? a.rows : 'FAIL ' + a.error}`).join(', ')}` : 'skipped (previous run still going)';
          console.log(`[${new Date().toISOString()}] ${why}: ${log}`);
        };
        cron.schedule('0 * * * *', () => { tick('hourly').catch((e) => console.error('cycle crashed:', e)); }, { timezone: 'Asia/Kolkata' });
        console.log('Scheduler started: running every hour (Asia/Kolkata). Running one cycle now...');
        await tick('startup');
        await new Promise<void>((resolve) => { for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => resolve()); });
        console.log('Shutting down.');
        break;
      }
      case 'detect': {
        console.log(await runDetection(c));
        const top = await c.anomalies.find({ status: 'open' }).sort({ ratio: -1 }).limit(Number(args[0] ?? 15)).toArray();
        for (const a of top) console.log(`${a.severity.padEnd(6)} ${a.month} ${a.item} | ${a.hostelName.slice(0, 45)} | ${a.requested} vs ~${a.expected} (x${a.ratio}) [${a.method}]`);
        const by = await c.anomalies.aggregate([{ $match: { status: 'open' } }, { $group: { _id: { m: '$month', s: '$severity', x: '$method' }, n: { $sum: 1 } } }, { $sort: { '_id.m': 1 } }]).toArray();
        console.log(by.map((b) => `${b._id.m} ${b._id.s} ${b._id.x}: ${b.n}`).join('\n'));
        break;
      }
      case 'check-students': {             // read-only: what does the portal's attendance report say for one hostel, day by day?
        const code = args[0];
        if (!code) throw new Error('Usage: cli check-students <hostelCode>');
        const acct = await c.accounts.findOne({ status: { $ne: 'disabled' } });
        if (!acct) throw new Error('No portal login is saved.');
        const token = await getToken(c, acct);
        for (let back = 0; back < 7; back++) {
          const date = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
          const rows = (await fetchAttendanceRows(token, code, date)) ?? [];
          console.log(`${date}: ${rows.length} classes, ${rows.reduce((n, r) => n + (Number(r.total_students) || 0), 0)} students  ${JSON.stringify(rows.map((r) => r.total_students))}`);
        }
        break;
      }
      case 'check-order': {                // read-only: asked-for and supplied quantity per item for one order, as the portal gives them
        const id = args[0];
        if (!id) throw new Error('Usage: cli check-order <requestId>');
        const acct = await c.accounts.findOne({ status: { $ne: 'disabled' } });
        if (!acct) throw new Error('No portal login is saved.');
        const rows = await fetchRequestItems(await getToken(c, acct), id);
        for (const r of rows) console.log(`${r.name.padEnd(40)} ${String(r.unit ?? '').padEnd(8)} asked=${r.requestedQuantity} supplied=${r.suppliedQuantity ?? '-'} received=${r.receivedQuantity ?? '-'}`);
        break;
      }
      case 'find-request': {               // read-only: which requests asked this much of an item?  find-request <part of item name> <quantity>
        const [frag, qtyArg] = args; const want = Number(qtyArg);
        const reqs = await c.requests.find({}, { projection: { items: 1, requestId: 1, hostelCode: 1, hostelName: 1, month: 1, status: 1, godownId: 1 } }).toArray();
        for (const r of reqs) for (const [k, q] of Object.entries(r.items)) if (k.toLowerCase().includes((frag ?? '').toLowerCase()) && Math.abs(q - want) < 1e-6) console.log(`${r.requestId} hostel ${r.hostelCode} ${r.hostelName} month ${r.month} status ${r.status} item ${k} = ${q}`);
        break;
      }
      case 'explain': {                    // read-only: why was (or was not) an item flagged? Nothing is written.
        const [codeRaw, monthArg] = args; const codeArg = codeRaw && codeRaw !== '-' ? codeRaw : undefined;
        const reqs = await c.requests.find({}, { projection: { items: 1, itemSnapshots: 1, godownId: 1, hostelCode: 1, hostelName: 1, districtName: 1, month: 1, status: 1, societyId: 1, requestId: 1, requestDate: 1 } }).toArray();
        const sizes = new Map((await c.hostels.find({ students: { $gt: 0 } }).toArray()).map((h) => [`${h.godownId}|${h.hostelCode}`, h.students!] as const));
        const month = monthArg ?? [...new Set(reqs.map((r) => r.month))].sort().at(-1)!;
        const now = detectAnomalies(reqs, [month], DEFAULT_CONFIG, sizes);
        const before = detectAnomalies(reqs, [month], { ...DEFAULT_CONFIG, ownConsistency: 0, minExcessUnits: {}, minExcessOther: 0, minStudents: 0, dropMinor: false }, sizes);
        const codes = codeArg ? [codeArg] : [...new Set(reqs.filter((r) => r.month === month && !/^reject/i.test(r.status)).sort((a, b) => Math.max(...Object.values(b.items)) - Math.max(...Object.values(a.items))).map((r) => r.hostelCode))].slice(0, 6);
        for (const code of codes) {
          const mine = reqs.filter((r) => r.hostelCode === code);
          const st = [...sizes].find(([k]) => k.endsWith(`|${code}`))?.[1];
          console.log(`\nhostel ${code}  month ${month}  students ${st ?? 'unknown'}  requests ${mine.filter((r) => r.month === month).length}`);
          for (const r of mine.sort((a, b) => a.month.localeCompare(b.month))) console.log(`  request ${r.requestId} ${r.month} status=${r.status} godown=${r.godownId} items=${Object.keys(r.items).length} total=${Object.values(r.items).reduce((x, y) => x + y, 0)} snapshots=${r.itemSnapshots ? 'yes' : 'no'}`);
          console.log(`  flags now for this hostel: ${now.filter((f) => f.hostelCode === code).map((f) => `${f.kind}:${f.item.split(' [unit:')[0]}`).join(', ') || 'none'}`);
          const top = Object.entries(mine.filter((r) => r.month === month && !/^reject/i.test(r.status)).reduce<Record<string, number>>((a, r) => { for (const [k, q] of Object.entries(r.items)) a[k] = (a[k] ?? 0) + q; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
          for (const [item, qty] of top) {
            const other = mine.filter((r) => r.month !== month).map((r) => `${r.month}:${r.items[item] ?? 0}`).join(' ');
            const a = now.find((f) => f.hostelCode === code && stableItemName(f.item) === stableItemName(item));
            const b = before.find((f) => f.hostelCode === code && stableItemName(f.item) === stableItemName(item));
            console.log(`  ${item.slice(0, 34).padEnd(34)} asked ${String(qty).padEnd(8)} other months [${other}]  now: ${a ? `FLAG ${a.severity} ${a.method} usual~${a.expected}` : 'no'}  without new rules: ${b ? `FLAG ${b.severity} ${b.method} usual~${b.expected}` : 'no'}`);
          }
        }
        break;
      }
      case 'bench': { await runBench(c); break; }
      case 'bench-quick': { await runBench(c, undefined, { blind: false }); break; }
      case 'review-stats': {
        const r = await reviewStats(c);
        console.log(`reviewed ${r.reviewed}: ${r.realProblems} real problems, ${r.falseAlarms} false alarms`);
        for (const g of [...r.bySeverity, ...r.byKind, ...r.byBasis]) console.log(`  ${g.label.padEnd(44)} ${g.realProblems}/${g.reviewed} real (${Math.round((100 * g.realProblems) / Math.max(1, g.reviewed))}%)`);
        break;
      }
      case 'sweep': { await runSweep(c); break; }
      case 'status': {
        const accts = await c.accounts.find({}, { projection: { passwordEnc: 0, tokenEnc: 0 } }).toArray();
        console.log(JSON.stringify(accts, null, 2));
        console.log('requests stored:', await c.requests.countDocuments());
        break;
      }
      default:
        console.log('Commands: add-account <username> | backfill | sync | cycle | serve | detect | check-students <hostelCode> | check-order <requestId> | status');
    }
  } finally {
    await closeDb();
  }
}
main().catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1); });
