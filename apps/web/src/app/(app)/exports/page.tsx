import { masterAdminAccess } from '@/lib/master-auth';
import { getDb } from '@/lib/db';
import { monthLabel } from '@/lib/format';
import { orderMonths, TABS } from '@/lib/orders';
import { Icon } from '@/components/Icons';
import { STATE_TEXT } from '@anomaly/core';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Full copy' };

type SP = { month?: string; district?: string; godown?: string; stage?: string; status?: string; state?: string };

/** Each download, and the choice (besides month, district and godown) that narrows it. */
const ITEMS = [
  ['orders', 'All orders', 'Every order with its stage, the date it reached each stage, and days at the current stage. Month = month placed.', 'stage'],
  ['flags', 'All unusual-request flags', 'Every flag, with its status. Month = month the goods were requested for.', 'status'],
  ['issues', 'All issues', 'Every issue, who raised it, where it stands, and what happened. Month = month the goods were requested for.', 'state'],
  ['remarks', 'All remarks', 'Every remark and call result, on issues and orders. Month = month written.', null],
] as const;
const FLAG_STATUSES = [['open', 'To check'], ['confirmed', 'Issue raised'], ['ignored', 'Ignored'], ['expected', 'Marked fine'], ['resolved', 'Resolved']] as const;

export default async function Exports({ searchParams }: { searchParams: Promise<SP> }) {
  if (!(await masterAdminAccess()).authorized) return <section className="hero"><h1>Full copy</h1><p className="lede">The full copy of the data is for administrators only.</p></section>;
  const sp = await searchParams;
  const c = await getDb();
  const [oMonths, aMonths, oDistricts, aDistricts, godowns] = await Promise.all([
    orderMonths(c, null), c.anomalies.distinct('month'), c.orders.distinct('districtName'), c.anomalies.distinct('districtName'),
    c.godowns.find({}, { projection: { godownId: 1, name: 1 } }).sort({ name: 1 }).toArray(),
  ]);
  const months = [...new Set([...oMonths, ...aMonths])].sort().reverse();
  const districts = [...new Set([...oDistricts, ...aDistricts])].filter(Boolean).sort();
  const link = (kind: string, extra: string | null) => {
    const p = new URLSearchParams();
    for (const k of ['month', 'district', 'godown'] as const) if (sp[k]) p.set(k, sp[k]!);
    if (extra && sp[extra as keyof SP]) p.set(extra, sp[extra as keyof SP]!);
    return `/exports/${kind}${p.size ? `?${p}` : ''}`;
  };
  const filtered = Object.values(sp).some(Boolean);
  return (
    <>
      <section className="hero">
        <h1>Full copy of the data</h1>
        <p className="lede">Excel files with everything the system holds, for keeping a year of records or handing them over. Leave the filters empty for every district and every month, or choose them to get just that part. The last sheet of each file lists the filters used. Downloads are logged.</p>
      </section>
      <form className="filters" method="get" action="/exports" aria-label="Choose what to include">
        <label className="select"><span>Month</span>
          <select name="month" defaultValue={sp.month ?? ''}><option value="">All months</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
        </label>
        <label className="select"><span>District</span>
          <select name="district" defaultValue={sp.district ?? ''}><option value="">All districts</option>{districts.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        </label>
        <label className="select"><span>Godown</span>
          <select name="godown" defaultValue={sp.godown ?? ''}><option value="">All godowns</option>{godowns.map((g) => <option key={g.godownId} value={g.godownId}>{g.name}</option>)}</select>
        </label>
        <label className="select"><span>Orders: stage</span>
          <select name="stage" defaultValue={sp.stage ?? ''}>{TABS.map((t) => <option key={t.key} value={t.key === 'all' ? '' : t.key}>{t.key === 'all' ? 'All stages' : t.label}</option>)}</select>
        </label>
        <label className="select"><span>Flags: status</span>
          <select name="status" defaultValue={sp.status ?? ''}><option value="">All statuses</option>{FLAG_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="select"><span>Issues: where it stands</span>
          <select name="state" defaultValue={sp.state ?? ''}><option value="">All</option>{Object.entries(STATE_TEXT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <button className="btn primary-ish" type="submit">Apply filters</button>
        {filtered && <a className="link-arrow" href="/exports">Clear</a>}
      </form>
      <div className="list">
        {ITEMS.map(([kind, title, text, extra]) => (
          <div className="row" key={kind}>
            <div><h3>{title}</h3><p className="meta">{text}</p></div>
            <a className="btn" href={link(kind, extra)}><Icon name="download" size={16} /> Download Excel</a>
          </div>
        ))}
      </div>
    </>
  );
}
