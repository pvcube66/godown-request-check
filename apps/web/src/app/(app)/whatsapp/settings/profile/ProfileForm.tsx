'use client';
import { useState, useTransition } from 'react';
import { VERTICALS, type BusinessProfile } from '@anomaly/core/profile-rules';
import Loader from '@/components/Loader';
import { showToast } from '@/components/toast';
import { saveProfileAction } from '../actions';

export default function ProfileForm({ initial }: { initial: BusinessProfile }) {
  const [p, setP] = useState({ ...initial, w1: initial.websites[0] ?? '', w2: initial.websites[1] ?? '' });
  const [err, setErr] = useState(''); const [pending, start] = useTransition();
  const set = (k: string, v: string) => setP({ ...p, [k]: v });
  const save = () => { setErr(''); start(async () => { const r = await saveProfileAction({ about: p.about, description: p.description, address: p.address, email: p.email, websites: [p.w1, p.w2].filter((w) => w.trim()), vertical: p.vertical, pictureUrl: '' }); if (!r.ok) setErr(r.message); else showToast({ message: r.message }); }); };
  return (
    <div className="profile-form">
      {initial.pictureUrl && /^https:\/\//.test(initial.pictureUrl) && <img className="profile-pic" src={initial.pictureUrl} alt="Profile picture" width={72} height={72} />}
      <label className="master-field">About <span className="mut">({p.about.length}/139)</span><input value={p.about} maxLength={139} onChange={(e) => set('about', e.target.value)} /></label>
      <label className="master-field">Description <span className="mut">({p.description.length}/512)</span><textarea rows={4} value={p.description} maxLength={512} onChange={(e) => set('description', e.target.value)} /></label>
      <label className="master-field">Address<input value={p.address} maxLength={256} onChange={(e) => set('address', e.target.value)} /></label>
      <label className="master-field">Email<input type="email" value={p.email} maxLength={128} onChange={(e) => set('email', e.target.value)} /></label>
      <label className="master-field">Website<input value={p.w1} placeholder="https://" onChange={(e) => set('w1', e.target.value)} /></label>
      <label className="master-field">Second website <span className="mut">(optional)</span><input value={p.w2} placeholder="https://" onChange={(e) => set('w2', e.target.value)} /></label>
      <label className="master-field">Type of business<select value={p.vertical} onChange={(e) => set('vertical', e.target.value)}>{VERTICALS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      {err && <p className="master-message master-error" role="alert">{err}</p>}
      <div><button className="btn primary-ish" disabled={pending} onClick={save}>{pending ? <Loader size="sm" label="" /> : null}Save to WhatsApp</button></div>
    </div>
  );
}
