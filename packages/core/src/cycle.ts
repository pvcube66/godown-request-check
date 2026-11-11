import type { Collections, RunDoc } from './db.js';
import { refreshCancellationCheck } from './cancellations.js';
import { runDetection } from './detector.js';
import { syncAll } from './sync.js';
import { syncIssues } from './issues.js';
import { runReminders } from './reminders.js';
import { runCampaigns } from './whatsappCampaigns.js';

let running = false;

/** One full pass: pull fresh requests for every account, look for anomalies, record the run.
 *  Never runs two at once (an overlapping hourly tick is skipped). */
export async function runCycle(c: Collections, trigger: string, mode: 'recent' | 'backfill' = 'recent'): Promise<RunDoc | null> {
  if (running) return null;
  running = true;
  try {
    const run = await syncAll(c, mode, trigger);
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
    running = false;
  }
}
