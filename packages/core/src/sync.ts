import { createHash } from 'node:crypto';
import { getToken } from './accounts.js';
import { requestItemSnapshots, syncItemMasters } from './itemMaster.js';
import type { ParsedRequest } from './types.js';
import type { MasterDataCollections } from './masterData.js';
import { AccountDoc, Collections, RunDoc } from './db.js';
import { parseGodownRows } from './parser.js';
import { syncOrders } from './orders.js';
import { syncFulfilment, syncOrderSuppliers } from './fulfilment.js';
import { fetchGodownMonth, fetchHostelStudents, fetchRequestItems, fetchRequestRemark, PortalAuthError } from './portalClient.js';

export const MONTH_NAMES = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

/** Month names to pull: all 12 for a backfill, otherwise the current month and the next two
 *  (hostels place requests ahead of time, e.g. December requests already exist in November). */
export function monthsToSync(mode: 'backfill' | 'recent', now = new Date()): string[] {
  if (mode === 'backfill') return MONTH_NAMES;
  const m = now.getUTCMonth();
  return [0, 1, 2].map((i) => MONTH_NAMES[(m + i) % 12]!).concat(MONTH_NAMES[(m + 11) % 12]!);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `deadline` (a time in ms) lets a short-lived host stop the optional catch-up steps early; they are all resumable and simply continue next hour. */
export async function syncAccount(c: Collections, acct: AccountDoc, months: string[], deadline?: number): Promise<number> {
  const time = () => deadline === undefined || Date.now() < deadline;
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
      await syncReportMasters(c, acct, rows, parsed);
      total += parsed.length;
      await sleep(300);                                    // be gentle with the portal
    }
  }
  if (time()) await syncRequestItems(c, acct, token);
  if (time()) try { await syncCancelReasons(c, acct, token); } catch (e) {
    if (e instanceof PortalAuthError) throw e;
    console.error('cancel reasons failed:', e instanceof Error ? e.message : e);
  }
  if (time()) try { await syncHostelSizes(c, acct, token); } catch (e) { console.error('hostel size refresh failed:', e instanceof Error ? e.message : e); }
  if (time()) try { await syncOrders(c, acct, token); } catch (e) { console.error('order tracking failed:', e instanceof Error ? e.message : e); }
  if (time()) try { await syncFulfilment(c, acct, token); } catch (e) {
    if (e instanceof PortalAuthError) throw e;
    console.error('supplied quantities failed:', e instanceof Error ? e.message : e);
  }
  if (time()) try { await syncOrderSuppliers(c, acct, token); } catch (e) {
    if (e instanceof PortalAuthError) throw e;
    console.error('suppliers failed:', e instanceof Error ? e.message : e);
  }
  await c.accounts.updateOne({ username: acct.username }, { $set: { lastSyncAt: new Date(), lastError: null } });
  return total;
}

/** Sync every active account independently: one failing login never blocks the others. */
export async function syncAll(c: Collections, mode: 'backfill' | 'recent', trigger = 'manual', deadline?: number): Promise<RunDoc> {
  const run: RunDoc = { startedAt: new Date(), ok: true, trigger, accounts: [] };
  const accts = await c.accounts.find({ status: { $ne: 'disabled' } }).toArray();
  for (const a of accts) {
    try {
      const rows = await syncAccount(c, a, monthsToSync(mode), deadline);
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

/** Same identity as mappingImport's district codes (NFKC, collapsed whitespace, case-insensitive). */
export function normalizedDistrictCode(name: string): string {
  const normalized = name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized ? `D-${createHash('sha256').update(normalized).digest('hex').slice(0, 24)}` : '';
}

const businessText = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

/** Portal provenance only: contacts fill blanks without overwriting manually maintained contacts. */
export async function syncReportMasters(c: Pick<MasterDataCollections, 'hostelsMaster' | 'godowns'>, acct: AccountDoc, rows: Record<string, unknown>[], parsed: ParsedRequest[]): Promise<void> {
  const now = new Date();
  const seenHostels = new Set<string>(), seenGodowns = new Set<number>(), seenContacts = new Set<string>();
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i]!, row = rows[i]!;
    const key = { godownId: p.godownId, hostelCode: p.hostelCode };
    const hostelKey = `${p.godownId}|${p.hostelCode}`;
    if (p.hostelCode) {
      if (!seenHostels.has(hostelKey)) {
        await c.hostelsMaster.updateOne(key, {
          $set: { hostelName: p.hostelName, districtName: p.districtName, districtCode: normalizedDistrictCode(p.districtName), updatedAt: now },
          $setOnInsert: { ...key, createdAt: now },
        }, { upsert: true });
        seenHostels.add(hostelKey);
      }
      const hostelPhone = businessText(row.mobile);
      if (hostelPhone && !seenContacts.has(`hostel:${hostelKey}`)) {
        await c.hostelsMaster.updateOne({ ...key, $or: [{ hostelPhone: { $exists: false } }, { hostelPhone: { $type: 'null' } }, { hostelPhone: '' }] }, { $set: { hostelPhone, updatedAt: now } });
        seenContacts.add(`hostel:${hostelKey}`);
      }
    }
    const gd = acct.godowns.find((g) => g.id === p.godownId);
    if (!gd) continue;
    if (!seenGodowns.has(gd.id)) {
      await c.godowns.updateOne({ godownId: gd.id }, {
        $set: { name: p.godownName || gd.name, portalLogin: acct.username, updatedAt: now },
        $setOnInsert: { godownId: gd.id, status: 'active', createdAt: now },
      }, { upsert: true });
      seenGodowns.add(gd.id);
    }
    for (const [field, value] of [
      ['contactPerson', businessText(row.godown_contact_person)], ['contactPhone', businessText(row.godown_contact_no)],
    ] as const) {
      const contactKey = `godown:${gd.id}:${field}`;
      if (value && !seenContacts.has(contactKey)) {
        await c.godowns.updateOne({ godownId: gd.id, $or: [{ [field]: { $exists: false } }, { [field]: { $type: 'null' } }, { [field]: '' }] }, { $set: { [field]: value, updatedAt: now } });
        seenContacts.add(contactKey);
      }
    }
  }
}

/** At most 40 attempts per account/run; successful empty reads are complete too.
 * Failures remain eligible next run. Authentication errors must reach the account/run status. */
export async function syncRequestItems(c: Collections, acct: AccountDoc, token: string): Promise<number> {
  const todo = await c.requests.find({
    godownId: { $in: acct.godowns.map((g) => g.id) },
    itemSnapshots: { $exists: false }, itemMetadataSyncedAt: { $exists: false },
  }).sort({ firstSeenAt: 1 }).limit(40).toArray();
  let done = 0;
  for (const r of todo) {
    try {
      const rows = await fetchRequestItems(token, r.requestId);
      // Strip remark fields: snapshots contain item metadata and quantities only.
      const items = rows.map(({ remarks, supplierRemarks, vendorRemarks, ...item }) => item);
      const snapshots = requestItemSnapshots(r.items, items);
      // Catalog all observed variants, even when an aggregate report key cannot be mapped safely.
      await syncItemMasters(c, items);
      const reason = rows.flatMap((row) => [row.remarks, row.supplierRemarks, row.vendorRemarks]).find((s) => s?.trim());
      await c.requests.updateOne({ godownId: r.godownId, requestId: r.requestId, itemMetadataSyncedAt: { $exists: false }, itemSnapshots: { $exists: false } }, {
        $set: {
          itemSnapshots: snapshots, itemMetadataSyncedAt: new Date(),
          ...(/^reject/i.test(r.status) && r.cancelReason === undefined ? { cancelReason: reason?.trim().slice(0, 400) ?? null } : {}),
        },
      });
      done++;
    } catch (e) {
      if (e instanceof PortalAuthError) throw e;
      console.error(`item metadata failed for ${r.requestId}:`, e instanceof Error ? e.message : e);
    }
    await sleep(200);
  }
  return done;
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
