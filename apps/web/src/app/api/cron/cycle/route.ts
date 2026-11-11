import { runCycle } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { authorised } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;                 // the longest a free Vercel plan allows; the work stops its optional steps before this
const BUDGET_MS = 40_000;

/** Same check as `npm run worker -- cycle`, started over the web so the website can do the job itself wherever it is hosted.
 *  This address has no sign-in, so it needs the secret (CRON_SECRET) as a bearer token; without it, or with a wrong one, nothing runs. */
async function handle(req: Request) {
  if (!authorised(req.headers.get('authorization'))) return new Response('Unauthorized', { status: 401 });
  const run = await runCycle(await getDb(), 'scheduler', 'recent', { budgetMs: BUDGET_MS });
  if (!run) return Response.json({ ok: true, skipped: 'Another check is already running.' });
  return Response.json({ ok: run.ok, newAnomalies: run.newAnomalies ?? 0, accounts: run.accounts.map((a) => ({ username: a.username, ok: a.ok, ...(a.ok ? { rows: a.rows } : { error: a.error }) })) }, { status: run.ok ? 200 : 207 });
}
export const GET = handle;
export const POST = handle;
