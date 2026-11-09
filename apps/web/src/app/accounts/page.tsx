import { getDb } from '@/lib/db';
import AddForm from './AddForm';
export const dynamic = 'force-dynamic';
const ist = (d?: Date | null) => d ? d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';

export default async function Accounts() {
  const c = await getDb();
  const accts = await c.accounts.find({}, { projection: { passwordEnc: 0, tokenEnc: 0 } }).toArray();
  return (
    <>
      <h1>Godown logins</h1>
      <table>
        <thead><tr><th>Username</th><th>Godowns</th><th>Status</th><th>Last login</th><th>Last sync</th><th>Error</th></tr></thead>
        <tbody>{accts.map((a) => (
          <tr key={a.username}><td>{a.username}</td><td>{a.godowns.map((g) => g.name).join(', ')}</td>
            <td className={a.status === 'active' ? 'ok' : 'bad'}>{a.status}</td><td>{ist(a.lastLoginAt)}</td><td>{ist(a.lastSyncAt)}</td><td className="bad">{a.lastError}</td></tr>))}</tbody>
      </table>
      <h2>Add another</h2>
      <AddForm />
    </>
  );
}
