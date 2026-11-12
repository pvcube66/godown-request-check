import { getDb } from '@/lib/db';
import { requireViewer } from '@/lib/viewer';
import { ago, when } from '@/lib/format';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Past checks' };

/** A short, plain reason for a failed check. The technical text is kept out of the screen. */
function plainError(e?: string): string {
  const t = e ?? '';
  if (/401|unauthori[sz]ed|token|password|login/i.test(t)) return 'The portal did not accept this godown login. Check the login under Godowns.';
  if (/timeout|timed out|ECONN|ENOTFOUND|fetch failed|network|HTTP 5\d\d/i.test(t)) return 'The portal could not be reached. The check will try again next hour.';
  return 'Something went wrong during this check. It will try again next hour.';
}

export default async function Runs() {
  const viewer = await requireViewer();
  if (viewer.role !== 'admin') return <div className="hero"><h1>Past checks</h1><p className="lede">The hourly check log is for administrators only.</p></div>;
  const c = await getDb();
  const runs = await c.runs.find().sort({ startedAt: -1 }).limit(40).toArray();
  return (
    <>
      <div className="hero"><h1>Past checks</h1><p className="lede">The system looks at the portal automatically every hour. Here are the latest checks.</p></div>
      {runs.length === 0 && <div className="empty">No checks have run yet.</div>}
      <div className="list">
        {runs.map((r) => {
          const rows = r.accounts.reduce((n, a) => n + (a.rows ?? 0), 0);
          const errs = r.accounts.filter((a) => !a.ok);
          return (
            <div className="row" key={String(r._id)}>
              <div>
                <h3>{when(r.startedAt)}</h3>
                <p className="meta">{ago(r.startedAt)}.{' '}
                  {r.ok ? `Refreshed ${rows.toLocaleString('en-IN')} recent requests from the portal and added ${r.newAnomalies ?? 0} new unusual-request ${r.newAnomalies === 1 ? 'flag' : 'flags'}.` : 'This check had a problem.'}</p>
                {errs.map((e) => <p key={e.username} className="bad-text">{e.username}: {plainError(e.error)}</p>)}
              </div>
              <span className={`state ${r.ok ? 'ok' : 'bad'}`}>{r.ok ? 'Worked' : 'Problem'}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
