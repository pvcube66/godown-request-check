'use client';
import { useState } from 'react';

/** Districts to tick for an operator or viewer: a search box narrows the list, and the count shows how many are ticked.
 *  Districts hidden by the search stay in the form, so a tick is never lost while searching. */
export default function DistrictPicker({ districts, selected }: { districts: { code: string; name: string }[]; selected: string[] }) {
  const [ticked, setTicked] = useState(() => new Set(selected));
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = (d: { name: string }) => !needle || d.name.toLowerCase().includes(needle);
  const visible = districts.filter(shown);
  const set = (codes: string[], on: boolean) => setTicked((t) => { const n = new Set(t); for (const c of codes) on ? n.add(c) : n.delete(c); return n; });
  return (
    <>
      <div className="district-tools">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search districts" aria-label="Search districts"
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} autoComplete="off" />
        <span className="mut small">{ticked.size} chosen</span>
        <button type="button" className="link-arrow" onClick={() => set(visible.map((d) => d.code), true)} disabled={!visible.length}>{needle ? 'Choose all shown' : 'Choose all'}</button>
        <button type="button" className="link-arrow" onClick={() => set(needle ? visible.map((d) => d.code) : districts.map((d) => d.code), false)} disabled={!ticked.size}>{needle ? 'Clear shown' : 'Clear all'}</button>
      </div>
      <div className="district-picks">
        {districts.map((d) => (
          <label key={d.code} hidden={!shown(d)}>
            <input type="checkbox" name="districts" value={d.code} checked={ticked.has(d.code)} onChange={(e) => set([d.code], e.target.checked)} /> {d.name}
          </label>
        ))}
      </div>
      {needle && visible.length === 0 && <span className="master-note">No district matches “{q}”.</span>}
    </>
  );
}
