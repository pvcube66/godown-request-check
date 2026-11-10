import { getDb } from '@/lib/db';
import { loadHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

/** For an uptime monitor: 200 while the hourly check has succeeded in the last 2 hours, 503 otherwise.
 *  Shows only times and counts, never names or data, so it needs no sign-in. */
export async function GET() {
  try {
    const h = await loadHealth(await getDb());
    return Response.json({ ok: h.ok, minutesSinceLastSuccess: h.minutesSince, lastRunOk: h.lastRunOk, godownLoginsNeedingAttention: h.needAttention }, { status: h.ok ? 200 : 503 });
  } catch {
    return Response.json({ ok: false, error: 'database unavailable' }, { status: 503 });
  }
}
