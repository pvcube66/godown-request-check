import type { Collections, RunDoc } from './db.js';
import { refreshCancellationCheck } from './cancellations.js';
import { runDetection } from './detector.js';
import { syncAll } from './sync.js';

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
    run.finishedAt = new Date();
    await c.runs.insertOne({ ...run });
    return run;
  } finally {
    running = false;
  }
}
