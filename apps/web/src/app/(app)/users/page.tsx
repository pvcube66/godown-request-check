import { masterAdminAccess } from '@/lib/master-auth';
import { ensureDistricts } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { ago, when } from '@/lib/format';
import ActionForm from '../master/ActionForm';
import DistrictPicker from './DistrictPicker';
import { createUserAction, resetPasswordAction, statusAction, updateUserAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users' };

const ROLE_TEXT = { admin: 'Administrator: sees every district and can change anything', operator: 'Operator: works on the chosen districts', viewer: 'View only: reads the chosen districts, cannot change anything' } as const;

export default async function Users() {
  if (!(await masterAdminAccess()).authorized) return <div className="master-page"><header className="master-header"><h1>Users</h1></header><section className="master-section master-gate"><h2>Administrators only</h2><p>Logins are created and changed by an administrator.</p></section></div>;
  const c = await getDb();
  await ensureDistricts(c).catch(() => undefined);      // any district the godown logins have shown is saved and listed here, no bootstrap needed
  const [users, districts, audit] = await Promise.all([
    c.users.find({}, { projection: { passwordHash: 0 } }).sort({ name: 1 }).toArray(),
    c.districts.find({}).toArray().then((ds) => ds.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))),
    c.auditLog.find({ action: { $regex: '^(login|logout|user\\.|export\\.|flag\\.)' } }).sort({ at: -1, _id: -1 }).limit(60).toArray(),
  ]);
  const nameOf = new Map(districts.map((d) => [d.code, d.name]));
  const who = new Map(users.map((u) => [`user:${u.userId}`, u.name]));
  const picker = (selected: string[] = []) => (
    <fieldset className="master-field master-span"><legend>Districts (operators and viewers)</legend>
      <DistrictPicker districts={districts.map((d) => ({ code: d.code, name: d.name }))} selected={selected} />
      {districts.length === 0 && <span className="master-note">No districts yet. They appear here by themselves after the first check of the portal.</span>}
    </fieldset>
  );
  const roleSelect = (value = 'operator') => (
    <label className="master-field">Role<select name="role" defaultValue={value}>{Object.entries(ROLE_TEXT).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
  );

  return (
    <div className="master-page">
      <header className="master-header"><div><h1>Users</h1><p>People who sign in to this dashboard. An operator or viewer sees only the districts chosen here, in every page, search and download.</p></div></header>

      <section className="master-section" aria-labelledby="new-user">
        <h2 id="new-user">Add a person</h2>
        <ActionForm action={createUserAction} submitLabel="Create login" pendingLabel="Creating…">
          <div className="master-fields">
            <label className="master-field">Name<input name="name" required maxLength={100} /></label>
            <label className="master-field">Phone<input name="phone" maxLength={20} inputMode="tel" /></label>
            <label className="master-field">Email (used to sign in)<input name="email" type="email" required maxLength={200} autoComplete="off" /></label>
            <label className="master-field">First password (10 or more characters)<input name="password" type="password" required minLength={10} maxLength={200} autoComplete="new-password" /></label>
            {roleSelect()}
            {picker()}
          </div>
        </ActionForm>
      </section>

      <section className="master-section" aria-labelledby="all-users">
        <div className="master-section-heading"><h2 id="all-users">People with a login</h2><span>{users.length}</span></div>
        {users.length === 0 && <p className="master-empty">No one has a login yet. Until you add an administrator here, sign in with the word “admin” and the dashboard password.</p>}
        {users.map((u) => (
          <details key={u.userId} className="master-record">
            <summary className="user-sum"><b>{u.name}</b> · {u.email} · {u.role === 'admin' ? 'Administrator' : u.role === 'operator' ? 'Operator' : 'View only'}{u.status === 'disabled' ? ' · TURNED OFF' : ''}{u.lockedUntil && u.lockedUntil > new Date() ? ' · LOCKED' : ''}
              <span className="mut small"> · {u.role === 'admin' ? 'all districts' : `${u.districts.length} district${u.districts.length === 1 ? '' : 's'}: ${u.districts.map((d) => nameOf.get(d) ?? d).join(', ')}`} · last sign-in {u.lastLoginAt ? ago(u.lastLoginAt) : 'never'}</span></summary>
            <div className="master-record-body">
              <ActionForm action={updateUserAction} submitLabel="Save changes">
                <input type="hidden" name="userId" value={u.userId} />
                <div className="master-fields">
                  <label className="master-field">Name<input name="name" defaultValue={u.name} required maxLength={100} /></label>
                  <label className="master-field">Phone<input name="phone" defaultValue={u.phone} maxLength={20} /></label>
                  <label className="master-field">Email<input name="email" type="email" defaultValue={u.email} required maxLength={200} /></label>
                  {roleSelect(u.role)}
                  {picker(u.districts)}
                </div>
              </ActionForm>
              <ActionForm action={resetPasswordAction} submitLabel="Set a new password">
                <input type="hidden" name="userId" value={u.userId} />
                <label className="master-field">New password (10 or more characters)<input name="password" type="password" required minLength={10} maxLength={200} autoComplete="new-password" /></label>
              </ActionForm>
              <ActionForm action={statusAction} submitLabel={u.status === 'active' ? 'Turn this login off' : 'Turn this login on'}>
                <input type="hidden" name="userId" value={u.userId} /><input type="hidden" name="status" value={u.status === 'active' ? 'disabled' : 'active'} />
              </ActionForm>
            </div>
          </details>
        ))}
      </section>

      <section className="master-section" aria-labelledby="activity">
        <h2 id="activity">Recent activity</h2>
        <p className="master-note">Sign-ins, downloads, user changes and “this looks wrong / fine” decisions. Most recent first.</p>
        {audit.length === 0 ? <p className="master-empty">Nothing recorded yet.</p> : (
          <div className="table-wrap"><table className="order-table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
            <tbody>{audit.map((a) => <tr key={String(a._id)}>
              <td>{when(a.at)}</td><td>{who.get(a.actor) ?? who.get(a.target) ?? a.actor}</td><td>{a.action}</td>
              <td className="mut small">{a.target.startsWith('user:') ? who.get(a.target) ?? a.target : a.target}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
