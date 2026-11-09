import { getToken } from './accounts.js';
import { AccountDoc, Collections, RunDoc } from './db.js';
import { parseGodownRows } from './parser.js';
import { fetchGodownMonth, fetchHostelStudents, fetchRequestRemark, PortalAuthError } from './portalClient.js';

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
  try { await syncCancelReasons(c, acct, token); } catch (e) { console.error('cancel reasons failed:', e instanceof Error ? e.message : e); }
  try { await syncHostelSizes(c, acct, token); } catch (e) { console.error('hostel size refresh failed:', e instanceof Error ? e.message : e); }
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

const SIZE_FRESH_DAYS = 7, SIZE_RETRY_DAYS = 2, SIZE_PER_RUN = 400;

/** Keeps each hostel's student count up to date (counts change slowly, so weekly is plenty).
 *  Hostels the portal has no count for are retried every couple of days. */
export async function syncHostelSizes(c: Collections, acct: AccountDoc, token: string): Promise<number> {
  let done = 0;
  for (const gd of acct.godowns) {
    const codes = (await c.requests.distinct('hostelCode', { godownId: gd.id })) as string[];
    const known = new Map((await c.hostels.find({ godownId: gd.id }).toArray()).map((h) => [h.hostelCode, h]));
    const now = Date.now();
    const due = codes.filter((code) => {
      const h = known.get(code);
      if (!h) return true;
      const age = (now - h.checkedAt.getTime()) / 86_400_000;
      return age > (h.students ? SIZE_FRESH_DAYS : SIZE_RETRY_DAYS);
    }).slice(0, SIZE_PER_RUN);
    for (const code of due) {
      let students: number | null;
      try { students = await fetchHostelStudents(token, code); }
      catch (e) { if (e instanceof PortalAuthError) throw e; continue; }       // skip this one, try next time
      await c.hostels.updateOne({ godownId: gd.id, hostelCode: code }, { $set: { students, checkedAt: new Date() } }, { upsert: true });
      done++;
      await sleep(200);
    }
  }
  return done;
}

/** For requests that people cancelled, keep the reason they wrote. These are real, human-labelled mistakes, used to check the detector. */
export async function syncCancelReasons(c: Collections, acct: AccountDoc, token: string): Promise<number> {
  const todo = await c.requests.find({ godownId: { $in: acct.godowns.map((g) => g.id) }, status: /^reject/i, cancelReason: { $exists: false } }).limit(40).toArray();
  let n = 0;
  for (const r of todo) {
    const reason = await fetchRequestRemark(token, r.requestId);
    await c.requests.updateOne({ godownId: r.godownId, requestId: r.requestId }, { $set: { cancelReason: reason } });
    n++; await sleep(200);
  }
  return n;
}
