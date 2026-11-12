import Link from 'next/link';
import { effectiveItemMetadata } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { masterAdminAccess } from '@/lib/master-auth';
import ActionForm from './ActionForm';
import ImportForm from './ImportForm';
import { bootstrapAction, godownContactAction, hostelContactAction, itemCorrectionAction, reassignAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Master data' };
export const runtime = 'nodejs';
export const maxDuration = 60;
const PAGE_SIZE = 30;
type Query = Record<string, string | string[] | undefined>;
const queryText = (query: Query, name: string) => typeof query[name] === 'string' ? query[name].trim().slice(0, 100) : '';
const pageNumber = (query: Query, name: string, total: number) => Math.min(Math.max(1, Math.floor(Number(queryText(query, name))) || 1), Math.max(1, Math.ceil(total / PAGE_SIZE)));
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const timestamp = (date: Date) => date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

function Pager({ query, page, total, field, anchor }: { query: Query; page: number; total: number; field: string; anchor: string }) {
  const last = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (next: number) => {
    const params = new URLSearchParams();
    for (const key of ['items', 'hostels', 'ip', 'hp']) {
      const value = queryText(query, key);
      if (value) params.set(key, value);
    }
    params.set(field, String(next));
    params.set('tab', anchor);
    return `/master?${params.toString()}`;
  };
  return <nav className="master-pager" aria-label={`${anchor} pages`}>
    <span>{total} records · Page {page} of {last}</span>
    {page > 1 && <Link href={href(page - 1)}>Previous</Link>}
    {page < last && <Link href={href(page + 1)}>Next</Link>}
  </nav>;
}

export default async function MasterPage({ searchParams }: { searchParams: Promise<Query> }) {
  const access = await masterAdminAccess();
  // Do not connect to Mongo or load a catalog unless the signed-in person is an administrator.
  if (!access.authorized) return <div className="master-page">
    <header className="master-header"><h1>Master data</h1><p>District assignments, item details and business contacts.</p></header>
    <section className="master-section master-gate" aria-labelledby="master-denied-title">
      <h2 id="master-denied-title">Administrators only</h2>
      <p>Master data can be changed only by an administrator. Ask an administrator if something here needs to change.</p>
    </section>
  </div>;

  const query = await searchParams;
  const TABS = [['mappings', 'Mappings'], ['items', 'Item master'], ['contacts', 'Contacts'], ['changes', 'Change log']] as const;
  const tab = (TABS.find(([k]) => k === queryText(query, 'tab'))?.[0] ?? 'mappings') as 'mappings' | 'items' | 'contacts' | 'changes';
  const itemQuery = queryText(query, 'items'), hostelQuery = queryText(query, 'hostels');
  const itemFilter = itemQuery ? { name: { $regex: escaped(itemQuery), $options: 'i' } } : {};
  const hostelFilter = hostelQuery ? { $or: [{ hostelName: { $regex: escaped(hostelQuery), $options: 'i' } }, { hostelCode: { $regex: escaped(hostelQuery), $options: 'i' } }] } : {};
  const c = await getDb();
  const [districts, godowns, suppliers, mappings, audit, itemTotal, hostelTotal] = await Promise.all([
    c.districts.find({}).sort({ name: 1 }).toArray(),
    c.godowns.find({}).sort({ name: 1 }).toArray(),
    c.suppliers.find({}).sort({ name: 1 }).toArray(),
    c.mappings.find({}).sort({ districtCode: 1, from: -1 }).toArray(),
    c.auditLog.find({}).sort({ at: -1, _id: -1 }).limit(100).toArray(),
    c.itemsMaster.countDocuments(itemFilter), c.hostelsMaster.countDocuments(hostelFilter),
  ]);
  const itemPage = pageNumber(query, 'ip', itemTotal), hostelPage = pageNumber(query, 'hp', hostelTotal);
  const [items, hostels] = await Promise.all([
    c.itemsMaster.find(itemFilter).sort({ name: 1, key: 1 }).skip((itemPage - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray(),
    c.hostelsMaster.find(hostelFilter).sort({ hostelName: 1, godownId: 1, hostelCode: 1 }).skip((hostelPage - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray(),
  ]);
  const districtByCode = new Map(districts.map((d) => [d.code, d]));
  const godownById = new Map(godowns.map((g) => [g.godownId, g]));
  const supplierByCode = new Map(suppliers.map((s) => [s.code, s]));
  const activeGodowns = godowns.filter((g) => g.status === 'active');
  const canReassign = districts.length > 0 && activeGodowns.length > 0 && suppliers.length > 0;

  return <div className="master-page">
    <header className="master-header">
      <div><h1>Master data</h1><p>Keep district assignments, item details and business contacts consistent without changing the government portal.</p></div>
      
    </header>
    <nav className="seg order-seg master-tabs" aria-label="Master data sections">
      {TABS.map(([k, label]) => <Link key={k} href={`/master?tab=${k}`} className={k === tab ? 'on' : ''} aria-current={k === tab ? 'page' : undefined}>{label}</Link>)}
    </nav>

    {tab === 'mappings' && <section className="master-section master-bootstrap" aria-labelledby="master-bootstrap-title">
      <div><h2 id="master-bootstrap-title">Start with data already stored here</h2><p>Bootstrap godowns, hostels and districts from saved accounts and requests. This does not log in to, refresh or write to the portal.</p>
        <p className="master-note">Catalog: {districts.length} districts, {godowns.length} godowns, {suppliers.length} suppliers. Import the mapping sheet to add suppliers and dated assignments.</p>
      </div>
      <ActionForm action={bootstrapAction} submitLabel="Bootstrap stored data" pendingLabel="Reading stored data…" />
    </section>}

    {tab === 'mappings' && <section className="master-section" id="mappings" aria-labelledby="master-mappings-title">
      <div className="master-section-heading"><h2 id="master-mappings-title">District → godown → supplier</h2><span>{mappings.length} history records</span></div>
      <p>Every assignment uses From [inclusive] and To [exclusive]. For example, an assignment ending on 1 June does not include 1 June; its successor starts that day. Blank To means open-ended, not necessarily current.</p>
      {!godowns.length && <p className="master-empty">No godown catalog yet. Bootstrap stored data first. If it is still empty, an authorized administrator must add a godown in Godowns; uploads never invent portal godown IDs.</p>}
      <div className="master-columns">
        <div className="master-panel">
          <h3>Import the client mapping sheet</h3>
          <p>CSV or XLSX, up to 2 MB and 500 data rows. XLSX reads only <strong>1 Mapping</strong>. Delete or replace the EXAMPLE row before uploading.</p>
          <ImportForm disabled={!godowns.length} />
          <details className="master-help"><summary>Required columns and history rules</summary>
            <p>District (as on portal), Godown name, Godown portal login (e.g. GDN-XXX), Supplier name, Effective from (YYYY-MM-DD), Effective to (blank = still current), Remarks, Notes.</p>
            <p>The godown name and login must identify an active stored godown. Districts and suppliers are matched by name or created. Exact repeats are skipped. To close an existing open interval, include its unchanged row with the end date and an adjacent successor row. Do not overwrite history. Operators and contacts sheets are not imported.</p>
            <p>Use plain values, not formulas or hyperlinks. Dates may be real Excel dates or YYYY-MM-DD text. Large or unusually complex workbooks are rejected before loading; use a mapping-only workbook if needed.</p>
          </details>
        </div>
        <div className="master-panel">
          <h3>Reassign a district</h3><p>Closes the assignment containing the chosen date and keeps its original end. Future scheduled assignments stay intact. A new assignment in a gap ends at the next scheduled start.</p>
          {!canReassign && <p className="master-empty">Bootstrap the catalog and import a mapping sheet with district and supplier names before reassigning. At least one active godown is required.</p>}
          <ActionForm action={reassignAction} submitLabel="Reassign district" pendingLabel="Reassigning…" disabled={!canReassign}>
            <fieldset className="master-fields" disabled={!canReassign}>
              <legend className="master-sr-only">New district assignment</legend>
              <label className="master-field">District<select name="districtCode" defaultValue="" required><option value="" disabled>Choose district</option>{districts.map((d) => <option key={d.code} value={d.code}>{d.name} ({d.code})</option>)}</select></label>
              <label className="master-field">Active godown<select name="godownId" defaultValue="" required><option value="" disabled>Choose godown</option>{activeGodowns.map((g) => <option key={g.godownId} value={g.godownId}>{g.name} ({g.portalLogin}; ID {g.godownId})</option>)}</select></label>
              <label className="master-field">Supplier<select name="supplierCode" defaultValue="" required><option value="" disabled>Choose supplier</option>{suppliers.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}</select></label>
              <label className="master-field">From [inclusive]<input name="from" type="date" required /></label>
              <label className="master-field master-span">Remarks<input name="remarks" maxLength={1000} /></label>
            </fieldset>
          </ActionForm>
        </div>
      </div>
      {!mappings.length ? <p className="master-empty">No mapping history yet. Fill the client template with real names and dates, remove the EXAMPLE row, then import it above.</p> : <div className="master-table-wrap" role="region" aria-label="Mapping history" tabIndex={0}><table className="master-table">
        <caption>Mapping history, newest start first within each district</caption><thead><tr><th scope="col">District</th><th scope="col">Godown</th><th scope="col">Supplier</th><th scope="col">From [inclusive]</th><th scope="col">To [exclusive]</th><th scope="col">Remarks</th><th scope="col">Changed by / created</th></tr></thead>
        <tbody>{mappings.map((m) => <tr key={`${m.districtCode}:${m.from}`}>
          <td><strong>{districtByCode.get(m.districtCode)?.name ?? 'Missing district'}</strong><span className="master-meta">{m.districtCode}</span></td>
          <td>{godownById.get(m.godownId)?.name ?? 'Missing godown'}<span className="master-meta">{godownById.get(m.godownId)?.portalLogin ?? 'Unknown login'} · ID {m.godownId}</span></td>
          <td>{supplierByCode.get(m.supplierCode)?.name ?? 'Missing supplier'}<span className="master-meta">{m.supplierCode}</span></td>
          <td><time dateTime={m.from}>{m.from}</time></td><td>{m.to ? <time dateTime={m.to}>{m.to}</time> : 'Open-ended'}</td><td>{m.remarks || '—'}</td><td>{m.changedBy}<span className="master-meta"><time dateTime={m.createdAt.toISOString()}>{timestamp(m.createdAt)} IST</time></span></td>
        </tr>)}</tbody>
      </table></div>}
    </section>}

    {tab === 'items' && <section className="master-section" id="items" aria-labelledby="master-items-title">
      <h2 id="master-items-title">Item master</h2><p>Correct units, pack sizes, brands and categories without changing the observed item identity or historical order snapshots. Blank fields explicitly mark metadata as unknown.</p>
      <form className="master-search" method="get" action="/master"><input type="hidden" name="tab" value="items" /><label className="master-field">Find item by name<input name="items" defaultValue={itemQuery} maxLength={100} type="search" /></label><input type="hidden" name="hostels" value={hostelQuery} /><button className="master-button" type="submit">Find items</button></form>
      {!items.length && <p className="master-empty">{itemQuery ? 'No items match this name. Clear the search to see the catalog.' : 'No item observations are stored yet. The next normal background sync will populate the item master; this page never fetches from the portal.'}</p>}
      <div className="master-records">{items.map((item) => {
        const metadata = effectiveItemMetadata(item);
        return <details className="master-record" key={item.key}>
          <summary><span><strong>{item.name}</strong><span className="master-meta">{item.itemId ? `ID ${item.itemId} · ` : ''}{metadata.unit || 'Unit unknown'} / {metadata.packSize || 'Pack unknown'}{metadata.brand ? ` · ${metadata.brand}` : ''}{metadata.category ? ` · ${metadata.category}` : ''}</span></span><span className="master-edit-label">Correct details</span></summary>
          <div className="master-record-body">            <p className="master-note">{item.overrideAt ? `Last corrected by ${item.overrideBy ?? 'admin'} on ${timestamp(item.overrideAt)} IST.` : 'No manual correction yet.'} Last observed {timestamp(item.lastSeenAt)} IST.</p>
            <ActionForm action={itemCorrectionAction} submitLabel="Save item correction">
              <input name="key" type="hidden" value={item.key} />
              <div className="master-fields">{(['unit', 'packSize', 'brand', 'category'] as const).map((field) => <label className="master-field" key={field}>{({ unit: 'Unit', packSize: 'Pack size', brand: 'Brand', category: 'Category' })[field]}<input name={field} defaultValue={metadata[field] ?? ''} maxLength={100} /></label>)}</div>
            </ActionForm>
          </div>
        </details>;
      })}</div>
      <Pager query={query} page={itemPage} total={itemTotal} field="ip" anchor="items" />
    </section>}

    {tab === 'contacts' && <section className="master-section" id="contacts" aria-labelledby="master-contacts-title">
      <h2 id="master-contacts-title">Business contacts</h2><p>Use official work numbers only: exactly 10 digits, without spaces or +91. Leave a number or contact person blank to remove it. Contact edits and their audit entries commit together.</p>
      <h3 className="master-subheading">Godown in-charges</h3>
      {!godowns.length && <p className="master-empty">Bootstrap stored accounts to load the godown catalog before editing contacts.</p>}
      <div className="master-records">{godowns.map((g) => <details className="master-record" key={g.godownId}>
        <summary><span><strong>{g.name}</strong><span className="master-meta">{g.portalLogin} · ID {g.godownId} · {g.status}{g.contactPerson ? ` · ${g.contactPerson}` : ''} · {g.contactPhone || 'No phone'}</span></span><span className="master-edit-label">Edit contact</span></summary>
        <div className="master-record-body"><ActionForm action={godownContactAction} submitLabel="Save godown contact">
          <input type="hidden" name="godownId" value={g.godownId} />
          <div className="master-fields"><label className="master-field">Contact person<input name="contactPerson" defaultValue={g.contactPerson ?? ''} maxLength={100} autoComplete="off" /></label><label className="master-field">Godown phone<input name="contactPhone" type="tel" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} defaultValue={g.contactPhone ?? ''} autoComplete="off" /></label></div>
        </ActionForm></div>
      </details>)}</div>
      <h3 className="master-subheading">Hostel phones</h3>
      <form className="master-search" method="get" action="/master"><input type="hidden" name="tab" value="contacts" /><label className="master-field">Find hostel by name or code<input name="hostels" defaultValue={hostelQuery} maxLength={100} type="search" /></label><input type="hidden" name="items" value={itemQuery} /><button className="master-button" type="submit">Find hostels</button></form>
      {!hostels.length && <p className="master-empty">{hostelQuery ? 'No hostels match. Clear the search or bootstrap stored request data.' : 'No hostels in the master catalog yet. Bootstrap saved requests; there is no contacts or operators sheet import on this page.'}</p>}
      <div className="master-records">{hostels.map((h) => <details className="master-record" key={`${h.godownId}:${h.hostelCode}`}>
        <summary><span><strong>{h.hostelName}</strong><span className="master-meta">{h.hostelCode} · {districtByCode.get(h.districtCode)?.name ?? h.districtName} ({h.districtCode || 'district not linked'}) · {godownById.get(h.godownId)?.name ?? 'Unknown godown'} (ID {h.godownId}) · {h.hostelPhone || 'No phone'}</span></span><span className="master-edit-label">Edit phone</span></summary>
        <div className="master-record-body"><ActionForm action={hostelContactAction} submitLabel="Save hostel phone">
          <input type="hidden" name="godownId" value={h.godownId} /><input type="hidden" name="hostelCode" value={h.hostelCode} />
          <label className="master-field">Hostel phone<input name="hostelPhone" type="tel" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} defaultValue={h.hostelPhone ?? ''} autoComplete="off" /></label>
        </ActionForm></div>
      </details>)}</div>
      <Pager query={query} page={hostelPage} total={hostelTotal} field="hp" anchor="contacts" />
    </section>}

    {tab === 'changes' && <section className="master-section" id="changes" aria-labelledby="master-changes-title">
      <h2 id="master-changes-title">Change log</h2><p>Latest 100 recorded changes. All times are India Standard Time (IST).</p>
      {!audit.length ? <p className="master-empty">No changes have been recorded yet. Imports, reassignments and contact or item corrections will appear here with their actor and time.</p> : <div className="master-table-wrap" role="region" aria-label="Master data change log" tabIndex={0}><table className="master-table">
        <caption>Most recent changes first</caption><thead><tr><th scope="col">Time (IST)</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Target / code</th></tr></thead>
        <tbody>{audit.map((entry, index) => <tr key={index}><td><time dateTime={entry.at.toISOString()}>{timestamp(entry.at)}</time></td><td>{entry.actor}</td><td>{entry.action}</td><td className="master-break">{entry.target}</td></tr>)}</tbody>
      </table></div>}
    </section>}
  </div>;
}
