'use client';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icons';
import Loader from '@/components/Loader';
import { showToast } from '@/components/toast';
import { addHostelsAction, addToGroupAction, createGroupAction, deleteContactsAction, deleteGroupAction, optOutAction, removeFromGroupAction, saveContactAction, type Result } from './actions';

export interface PersonRow { phone: string; masked: string; name: string; email: string; tags: string[]; notes: string; source: string; optedOut: boolean }
const done = (r: Result, after?: () => void) => { showToast({ message: r.message, ...(r.ok ? {} : { tone: 'bad' as const }) }); if (r.ok) after?.(); };

export function ContactsTable({ rows, groups }: { rows: PersonRow[]; groups: string[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [group, setGroup] = useState(groups[0] ?? '');
  const [editing, setEditing] = useState<PersonRow | 'new' | null>(null);
  const all = rows.length > 0 && rows.every((r) => sel.has(r.phone));
  const toggle = (p: string) => setSel((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const run = (fn: () => Promise<Result>) => start(async () => { const r = await fn(); done(r, () => { setSel(new Set()); router.refresh(); }); });
  const chosen = [...sel];

  return (
    <>
      <div className="toolbar-right push">
        <button className="btn" onClick={() => start(async () => done(await addHostelsAction(), () => router.refresh()))} disabled={pending}>{pending ? <Loader size="sm" label="" /> : null}Add hostels</button>
        <ImportButton groups={groups} />
        <button className="btn primary-ish" onClick={() => setEditing('new')}>Add contact</button>
      </div>

      {chosen.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Selected contacts">
          <b>{chosen.length} selected</b>
          {groups.length > 0 && <><select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group">{groups.map((g) => <option key={g}>{g}</option>)}</select><button className="btn" disabled={pending} onClick={() => run(() => addToGroupAction(group, chosen))}>Add to group</button></>}
          <button className="btn" disabled={pending} onClick={() => run(() => createGroupPrompt(chosen))}>New group from these</button>
          <button className="btn" disabled={pending} onClick={() => run(() => optOutAction(chosen, true))}>Opt out</button>
          <button className="btn problem" disabled={pending} onClick={() => { if (confirm(`Delete ${chosen.length} contact(s)? This cannot be undone.`)) run(() => deleteContactsAction(chosen)); }}>Delete</button>
        </div>
      )}

      {rows.length === 0 ? <div className="empty">No contacts match. Add one, import a sheet, or use “Add hostels”.</div> : (
        <div className="table-wrap"><table className="order-table">
          <thead><tr><th style={{ width: 34 }}><input type="checkbox" aria-label="Select all on this page" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.phone)))} /></th><th>Name</th><th>Status</th><th>Tags</th><th>Source</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.phone}>
              <td><input type="checkbox" aria-label={`Select ${r.name || r.masked}`} checked={sel.has(r.phone)} onChange={() => toggle(r.phone)} /></td>
              <td><b>{r.name || 'No name'}</b><div className="mut small">+{r.phone}{r.email ? ` · ${r.email}` : ''}</div></td>
              <td>{r.optedOut ? <span className="tpl-status s-REJECTED">Opted out</span> : <span className="tpl-status s-APPROVED">Active</span>}</td>
              <td>{r.tags.map((t) => <span key={t} className="tag-chip">{t}</span>)}</td>
              <td className="mut small">{r.source}</td>
              <td className="num"><span className="row-actions">
                {!r.optedOut && <Link className="btn" href={`/whatsapp/send?to=${r.phone}`}>Message</Link>}
                <button className="btn" onClick={() => setEditing(r)}>Edit</button>
              </span></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editing && <ContactDialog person={editing === 'new' ? null : editing} onClose={() => { setEditing(null); router.refresh(); }} />}
    </>
  );
}

async function createGroupPrompt(phones: string[]): Promise<Result> {
  const name = prompt('Name for the new group?')?.trim();
  if (!name) return { ok: false, message: 'No group was created.' };
  return createGroupAction(name, phones);
}

function ContactDialog({ person, onClose }: { person: PersonRow | null; onClose: () => void }) {
  const [f, setF] = useState({ phone: person?.phone ?? '', name: person?.name ?? '', email: person?.email ?? '', tags: person?.tags.join(', ') ?? '', notes: person?.notes ?? '' });
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const save = () => { setErr(''); start(async () => { const r = await saveContactAction({ ...f, editing: !!person }); if (!r.ok) { setErr(r.message); return; } showToast({ message: r.message }); onClose(); }); };
  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={person ? 'Edit contact' : 'Add contact'} onClick={(e) => e.stopPropagation()}>
        <h3>{person ? 'Edit contact' : 'Add contact'}</h3>
        <label className="master-field">Phone (with country code)<input value={f.phone} disabled={!!person} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="919876543210" inputMode="tel" autoFocus={!person} /></label>
        <label className="master-field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={100} /></label>
        <label className="master-field">Email<input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} type="email" /></label>
        <label className="master-field">Tags <span className="mut">(separated by commas)</span><input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></label>
        <label className="master-field">Notes<textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={1000} /></label>
        {err && <p className="master-message master-error" role="alert">{err}</p>}
        <div className="modal-actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary-ish" disabled={pending} onClick={save}>{pending ? <Loader size="sm" label="" /> : null}Save</button></div>
        {person && <OptRow person={person} onChange={onClose} />}
      </div>
    </div>
  );
}
function OptRow({ person, onChange }: { person: PersonRow; onChange: () => void }) {
  const [pending, start] = useTransition();
  return <div className="opt-row"><span>{person.optedOut ? 'This person opted out and is not messaged.' : 'Opt this person out of WhatsApp messages.'}</span><button className="btn" disabled={pending} onClick={() => start(async () => { done(await optOutAction([person.phone], !person.optedOut), onChange); })}>{person.optedOut ? 'Opt back in' : 'Opt out'}</button></div>;
}

function ImportButton({ groups }: { groups: string[] }) {
  const [open, setOpen] = useState(false);
  return <><button className="btn" onClick={() => setOpen(true)}>Import</button>{open && <ImportDialog groups={groups} onClose={() => setOpen(false)} />}</>;
}
interface ImportSummary { added: number; updated: number; total: number; skipped: { row: number; reason: string }[]; moreSkipped: number; committed: boolean }
function ImportDialog({ groups, onClose }: { groups: string[]; onClose: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tags, setTags] = useState(''); const [group, setGroup] = useState('');
  const [sum, setSum] = useState<ImportSummary | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const send = async (commit: boolean) => {
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr('Choose a .csv or .xlsx file first.'); return; }
    setBusy(true); setErr('');
    try {
      const fd = new FormData(); fd.set('file', file); fd.set('tags', tags); fd.set('group', group); fd.set('commit', commit ? '1' : '0');
      const res = await fetch('/whatsapp/people/import', { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? 'Could not import.'); return; }
      setSum(j);
      if (commit) { showToast({ message: `${j.added} added, ${j.updated} updated.` }); router.refresh(); onClose(); }
    } catch { setErr('Could not import. Check your connection and try again.'); } finally { setBusy(false); }
  };
  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Import contacts" onClick={(e) => e.stopPropagation()}>
        <h3>Import contacts</h3>
        <p className="mut small">A .csv or .xlsx file with a column called <b>phone</b>. Optional columns: name, email, tags, notes. Up to 2,000 rows from Excel, 5,000 from CSV.</p>
        <label className="master-field">File<input ref={fileRef} type="file" accept=".csv,.xlsx" onChange={() => setSum(null)} /></label>
        <label className="master-field">Add these tags to everyone <span className="mut">(optional)</span><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="march-batch" /></label>
        {groups.length > 0 && <label className="master-field">Add everyone to a group <span className="mut">(optional)</span><select value={group} onChange={(e) => setGroup(e.target.value)}><option value="">No group</option>{groups.map((g) => <option key={g}>{g}</option>)}</select></label>}
        {err && <p className="master-message master-error" role="alert">{err}</p>}
        {sum && !sum.committed && (
          <div className="import-sum"><b>{sum.added} new</b> · {sum.updated} already saved (details updated) · <b className={sum.skipped.length + sum.moreSkipped ? 'bad-text' : ''}>{sum.skipped.length + sum.moreSkipped} skipped</b>
            {sum.skipped.length > 0 && <ul>{sum.skipped.map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}{sum.moreSkipped > 0 && <li>…and {sum.moreSkipped} more</li>}</ul>}
          </div>
        )}
        <div className="modal-actions"><button className="btn" onClick={onClose}>Cancel</button>
          {!sum ? <button className="btn primary-ish" disabled={busy} onClick={() => send(false)}>{busy ? <Loader size="sm" label="" /> : null}Check the file</button>
            : <button className="btn primary-ish" disabled={busy || sum.added + sum.updated === 0} onClick={() => send(true)}>{busy ? <Loader size="sm" label="" /> : null}Save {sum.added + sum.updated} contact{sum.added + sum.updated === 1 ? '' : 's'}</button>}
        </div>
      </div>
    </div>
  );
}

export function GroupRow({ name, members }: { name: string; members: { phone: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) => start(async () => { done(await fn(), () => router.refresh()); });
  return (
    <tr>
      <td><details className="tpl"><summary><b>{name}</b></summary>
        {members.length === 0 ? <p className="mut small">No one yet. Select people on the Contacts tab and choose “Add to group”.</p> : (
          <ul className="member-list">{members.map((m) => <li key={m.phone}><span>{m.name || 'No name'} <span className="mut small">+{m.phone}</span></span><button className="btn" disabled={pending} onClick={() => run(() => removeFromGroupAction(name, [m.phone]))}>Remove</button></li>)}</ul>
        )}</details></td>
      <td className="num">{members.length}</td>
      <td className="num"><span className="row-actions">
        {members.length > 0 && <Link className="btn" href={`/whatsapp/send?group=${encodeURIComponent(name)}`}>Message group</Link>}
        <button className="btn" disabled={pending} onClick={() => { if (confirm(`Delete the group “${name}”? The people in it are kept.`)) run(() => deleteGroupAction(name)); }}>Delete</button>
      </span></td>
    </tr>
  );
}

export function NewGroup() {
  const router = useRouter();
  const [name, setName] = useState(''); const [pending, start] = useTransition();
  return (
    <form className="toolbar-search" onSubmit={(e) => { e.preventDefault(); start(async () => { done(await createGroupAction(name, []), () => { setName(''); router.refresh(); }); }); }}>
      <input className="plain-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name" maxLength={100} aria-label="New group name" />
      <button className="btn primary-ish" disabled={pending || !name.trim()}>Create group</button>
    </form>
  );
}
