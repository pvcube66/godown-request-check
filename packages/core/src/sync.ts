import { getToken } from './accounts.js';
import { AccountDoc, Collections, RunDoc } from './db.js';
import { parseGodownRows } from './parser.js';
import { fetchGodownMonth, PortalAuthError } from './portalClient.js';

export const MONTH_NAMES = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

/** Month names to pull: all 12 for a backfill, otherwise the current month and the next two
 *  (hostels place requests ahead of time, e.g. December requests already exist in November). */
export function monthsToSync(mode: 'backfill' | 'recent', now = new Date()): string[] {
  if (mode === 'backfill') return MONTH_NAMES;
  const m = now.getUTCMonth();
  return [0, 1, 2].map((i) => MONTH_NAMES[(m + i) % 12]!).concat(MONTH_NAMES[(m + 11) % 12]!);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function syncAccount(c: Collections, acct: AccountDoc, months: string[]): Promise<number> {
  let token = await getToken(c, acct);
  let total = 0;
  for (const gd of acct.godowns) {
    for (const month of months) {
      let rows;
      try {
        rows = await fetchGodownMonth(token, gd.id, month);
      } catch (e) {
        if (!(e instanceof PortalAuthError)) throw e;
        token = await getToken(c, acct, true);            // token rejected -> log in again, retry once
        rows = await fetchGodownMonth(token, gd.id, month);
      }
      const parsed = parseGodownRows(rows, gd.id);
      const now = new Date();
      if (parsed.length) {
        await c.requests.bulkWrite(parsed.map((p) => ({
          updateOne: {
            filter: { godownId: p.godownId, requestId: p.requestId },
            update: { $set: { ...p, updatedAt: now }, $setOnInsert: { firstSeenAt: now } },
            upsert: true,
          },
        })));
      }
      total += parsed.length;
      await sleep(300);                                    // be gentle with the portal
    }
  }
  await c.accounts.updateOne({ username: acct.username }, { $set: { lastSyncAt: new Date(), lastError: null } });
  return total;
}

/** Sync every active account independently: one failing login never blocks the others. */
export async function syncAll(c: Collections, mode: 'backfill' | 'recent', trigger = 'manual'): Promise<RunDoc> {
  const run: RunDoc = { startedAt: new Date(), ok: true, trigger, accounts: [] };
  const accts = await c.accounts.find({ status: { $ne: 'disabled' } }).toArray();
  for (const a of accts) {
    try {
      const rows = await syncAccount(c, a, monthsToSync(mode));
      run.accounts.push({ username: a.username, ok: true, rows });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      run.ok = false;
      run.accounts.push({ username: a.username, ok: false, error });
      await c.accounts.updateOne({ username: a.username }, { $set: { status: 'needs_attention', lastError: error } });
    }
  }
  run.finishedAt = new Date();
  return run;
}
