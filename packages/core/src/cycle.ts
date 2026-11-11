import type { Collections, RunDoc } from './db.js';
import { refreshCancellationCheck } from './cancellations.js';
import { runDetection } from './detector.js';
import { syncAll } from './sync.js';
import { syncIssues } from './issues.js';
import { runReminders } from './reminders.js';
import { runCampaigns } from './whatsappCampaigns.js';
import { ensureDistricts } from './seedMasterData.js';

let running = false;

/** One full pass: pull fresh requests for every account, look for anomalies, record the run.
 *  Never runs two at once (an overlapping hourly tick is skipped). */
export interface CycleOptions { budgetMs?: number }

const LOCK_MINUTES = 10;
/** One check at a time across every place that can start one (this computer, the website's scheduler, another server): a short-lived lock in the database. */
export async function acquireCycleLock(c: Collections, now = new Date()): Promise<boolean> {
  try {
    const r = await c.settings.updateOne({ _id: 'cycle-lock', $or: [{ until: { $lt: now } }, { until: { $exists: false } }] } as never, { $set: { until: new Date(now.getTime() + LOCK_MINUTES * 60_000) } } as never, { upsert: true });
    return r.matchedCount === 1 || r.upsertedCount === 1;
  } catch (e) { if ((e as { code?: number }).code === 11000) return false; throw e; }      // someone else holds it
}
export const releaseCycleLock = (c: Collections) => c.settings.updateOne({ _id: 'cycle-lock' } as never, { $set: { until: new Date(0) } } as never).catch(() => undefined);

export async function runCycle(c: Collections, trigger: string, mode: 'recent' | 'backfill' = 'recent', opts: CycleOptions = {}): Promise<RunDoc | null> {
  if (running) return null;
  running = true;
  if (!(await acquireCycleLock(c))) { running = false; return null; }
  try {
    const run = await syncAll(c, mode, trigger, opts.budgetMs ? Date.now() + opts.budgetMs : undefined);
    await ensureDistricts(c).catch(() => undefined);      // new districts appear on the Users page by themselves
    try {
      run.newAnomalies = (await runDetection(c)).created;
      await refreshCancellationCheck(c).catch(() => undefined);      // keep the Accuracy page's real-cancellation check fresh
    } catch (e) {
      run.ok = false;
      run.accounts.push({ username: '(detector)', ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    try { await syncIssues(c); } catch (e) {            // follow open issues: did the portal reject it, did a new indent arrive?
      run.ok = false;
      run.accounts.push({ username: '(issues)', ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    try { await runReminders(c); } catch (e) {          // WhatsApp reminders (preview or live, as set by an administrator)
      run.accounts.push({ username: '(whatsapp)', ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    try { await runCampaigns(c); } catch (e) {          // keeps running campaigns moving
      run.accounts.push({ username: '(campaigns)', ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    run.finishedAt = new Date();
    await c.runs.insertOne({ ...run });
    return run;
  } finally {
    await releaseCycleLock(c);
    running = false;
  }
}
