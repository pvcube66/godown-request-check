import { getDb } from '@/lib/db';
export const dynamic = 'force-dynamic';
const ist = (d?: Date) => d ? d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';

export default async function Runs() {
  const c = await getDb();
  const runs = await c.runs.find().sort({ startedAt: -1 }).limit(50).toArray();
  return (
    <>
      <h1>Run history</h1>
      <table>
        <thead><tr><th>Started (IST)</th><th>Trigger</th><th>Result</th><th className="num">New flags</th><th>Logins</th></tr></thead>
        <tbody>{runs.map((r) => (
          <tr key={String(r._id)}>
            <td>{ist(r.startedAt)}</td><td>{r.trigger}</td><td className={r.ok ? 'ok' : 'bad'}>{r.ok ? 'OK' : 'Problem'}</td>
            <td className="num">{r.newAnomalies ?? 0}</td>
            <td>{r.accounts.map((a) => <div key={a.username}>{a.username}: {a.ok ? `${a.rows ?? 0} rows` : <span className="bad">{a.error}</span>}</div>)}</td>
          </tr>))}</tbody>
      </table>
    </>
  );
}
