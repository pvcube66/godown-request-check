import { getDb } from '@/lib/db';
import { ago, when } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function Runs() {
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
                  {r.ok ? `Looked at ${rows.toLocaleString('en-IN')} requests and found ${r.newAnomalies ?? 0} new unusual ${r.newAnomalies === 1 ? 'one' : 'ones'}.` : 'This check had a problem.'}</p>
                {errs.map((e) => <p key={e.username} className="bad-text">{e.username}: {e.error}</p>)}
              </div>
              <span className={`state ${r.ok ? 'ok' : 'bad'}`}>{r.ok ? 'Worked' : 'Problem'}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
