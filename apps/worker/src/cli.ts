import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { addAccount, closeDb, connectDb, runDetection, syncAll } from '@anomaly/core';

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
      case 'detect': {
        console.log(await runDetection(c));
        const top = await c.anomalies.find({ status: 'open' }).sort({ ratio: -1 }).limit(Number(args[0] ?? 15)).toArray();
        for (const a of top) console.log(`${a.severity.padEnd(6)} ${a.month} ${a.item} | ${a.hostelName.slice(0, 45)} | ${a.requested} vs ~${a.expected} (x${a.ratio}) [${a.method}]`);
        const by = await c.anomalies.aggregate([{ $match: { status: 'open' } }, { $group: { _id: { m: '$month', s: '$severity', x: '$method' }, n: { $sum: 1 } } }, { $sort: { '_id.m': 1 } }]).toArray();
        console.log(by.map((b) => `${b._id.m} ${b._id.s} ${b._id.x}: ${b.n}`).join('\n'));
        break;
      }
      case 'status': {
        const accts = await c.accounts.find({}, { projection: { passwordEnc: 0, tokenEnc: 0 } }).toArray();
        console.log(JSON.stringify(accts, null, 2));
        console.log('requests stored:', await c.requests.countDocuments());
        break;
      }
      default:
        console.log('Commands: add-account <username> | backfill | sync | detect | status');
    }
  } finally {
    await closeDb();
  }
}
main().catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1); });
