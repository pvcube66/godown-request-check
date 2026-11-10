import { masterAdminAccess } from '@/lib/master-auth';
import { Icon } from '@/components/Icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Full copy' };

const ITEMS = [
  ['orders', 'All orders', 'Every order with its stage, the date it reached each stage, and days at the current stage.'],
  ['flags', 'All unusual-request flags', 'Every flag, with its status.'],
  ['issues', 'All issues', 'Every issue, who raised it, where it stands, and what happened.'],
  ['remarks', 'All remarks', 'Every remark and call result, on issues and orders.'],
] as const;

export default async function Exports() {
  if (!(await masterAdminAccess()).authorized) return <section className="hero"><h1>Full copy</h1><p className="lede">The full copy of the data is for administrators only.</p></section>;
  return (
    <>
      <section className="hero">
        <h1>Full copy of the data</h1>
        <p className="lede">Excel files with everything the system holds, for keeping a year of records or handing them over. Each one covers every district and every month. Downloads are logged.</p>
      </section>
      <div className="list">
        {ITEMS.map(([kind, title, text]) => (
          <div className="row" key={kind}>
            <div><h3>{title}</h3><p className="meta">{text}</p></div>
            <a className="btn" href={`/exports/${kind}`}><Icon name="download" size={16} /> Download Excel</a>
          </div>
        ))}
      </div>
    </>
  );
}
