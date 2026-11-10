import type { Collections } from '@anomaly/core';

/** The hourly check should succeed every hour. Two hours without a successful run means something is wrong. */
export const STALE_MINUTES = 120;

export interface Health { ok: boolean; lastSuccessAt: Date | null; minutesSince: number | null; lastRunOk: boolean | null; needAttention: number }

export function judge(lastSuccess: Date | null, lastRunOk: boolean | null, needAttention: number, now = new Date()): Health {
  const minutesSince = lastSuccess ? Math.max(0, Math.floor((now.getTime() - lastSuccess.getTime()) / 60_000)) : null;
  return { ok: minutesSince !== null && minutesSince <= STALE_MINUTES, lastSuccessAt: lastSuccess, minutesSince, lastRunOk, needAttention };
}

export async function loadHealth(c: Collections, now = new Date()): Promise<Health> {
  const [last, lastOk, attention] = await Promise.all([
    c.runs.find({}, { projection: { ok: 1 } }).sort({ startedAt: -1 }).limit(1).next(),
    c.runs.find({ ok: true }, { projection: { finishedAt: 1, startedAt: 1 } }).sort({ startedAt: -1 }).limit(1).next(),
    c.accounts.countDocuments({ status: 'needs_attention' }),
  ]);
  return judge(lastOk ? (lastOk.finishedAt ?? lastOk.startedAt) : null, last ? last.ok : null, attention, now);
}
