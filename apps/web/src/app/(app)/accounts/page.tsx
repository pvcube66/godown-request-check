import { getDb } from '@/lib/db';
import { ago } from '@/lib/format';
import AddForm from './AddForm';
import { masterAdminAccess } from '@/lib/master-auth';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;     // adding a godown loads its whole history, which can take most of a minute

export default async function Accounts() {
  if (!(await masterAdminAccess()).authorized) return <section className="hero"><h1>Godowns</h1><p className="lede">Godown logins are managed by administrators only.</p></section>;
  const c = await getDb();
  const accts = await c.accounts.find({}, { projection: { passwordEnc: 0, tokenEnc: 0 } }).toArray();
  return (
    <>
      <div className="hero"><h1>Godowns</h1><p className="lede">These are the godowns we are watching. Each one needs a working login on the government portal.</p></div>
      <div className="list" style={{ marginBottom: 32 }}>
        {accts.map((a) => (
          <div className="row" key={a.username}>
            <div>
              <h3>{a.godowns.map((g) => g.name).join(', ')}</h3>
              <p className="meta">Login: {a.username}. Last updated {ago(a.lastSyncAt)}.</p>
              {a.status !== 'active' && a.lastError && <p className="bad-text">{a.lastError}</p>}
            </div>
            <span className={`state ${a.status === 'active' ? 'ok' : 'bad'}`}>{a.status === 'active' ? 'Working' : a.status === 'disabled' ? 'Turned off' : 'Needs attention'}</span>
          </div>
        ))}
      </div>
      <AddForm />
    </>
  );
}
