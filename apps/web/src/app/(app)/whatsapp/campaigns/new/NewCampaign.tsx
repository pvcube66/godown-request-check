'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { variablesIn } from '@anomaly/core/template-rules';
import Loader from '@/components/Loader';
import WaPreview from '@/components/WaPreview';
import { createCampaignAction, reviewCampaignAction } from '../actions';

interface Tpl { name: string; language: string; body: string; header: string }
type Review = { people: number; optedOut: number; will: number; sample: string };

export default function NewCampaign({ templates, groups, tags }: { templates: Tpl[]; groups: { name: string; count: number }[]; tags: { tag: string; n: number }[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [tplName, setTplName] = useState(templates[0]?.name ?? '');
  const tpl = templates.find((t) => t.name === tplName);
  const nb = tpl ? variablesIn(tpl.body).length : 0, nh = tpl ? variablesIn(tpl.header).length : 0;
  const [vals, setVals] = useState<Record<string, string[]>>({});
  const body = Array.from({ length: nb }, (_, i) => vals[tplName + 'b']?.[i] ?? ''), head = Array.from({ length: nh }, (_, i) => vals[tplName + 'h']?.[i] ?? '');
  const [everyone, setEveryone] = useState(false);
  const [selTags, setSelTags] = useState<Set<string>>(new Set()); const [selGroups, setSelGroups] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<Review | null>(null); const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const flip = (s: Set<string>, v: string, put: (n: Set<string>) => void) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); put(n); setReview(null); };
  const input = () => ({ name, template: { name: tpl!.name, language: tpl!.language }, body, header: head, audience: { all: everyone, tags: [...selTags], groups: [...selGroups] } });
  const set = (k: 'b' | 'h', i: number, v: string, cur: string[]) => { const n = [...cur]; n[i] = v; setVals({ ...vals, [tplName + k]: n }); setReview(null); };
  const ready = !!tpl && name.trim().length >= 2 && body.every((v) => v.trim()) && head.every((v) => v.trim()) && (everyone || selTags.size > 0 || selGroups.size > 0);

  const doReview = () => { setErr(''); start(async () => { const r = await reviewCampaignAction(input()); if (!r.ok) { setErr(r.message); return; } setReview(r); }); };
  const create = () => { setErr(''); start(async () => { const r = await createCampaignAction(input()); if (!r.ok) { setErr(r.message); return; } router.push(`/whatsapp/campaigns/${r.id}`); }); };

  if (templates.length === 0) return <div className="empty">No approved templates yet. Create one under Templates and wait for WhatsApp to approve it.</div>;
  return (
    <div className="send-grid">
      <div className="send-col">
        <label className="master-field">Campaign name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Diwali greetings" /></label>
        <label className="master-field">Template<select value={tplName} onChange={(e) => { setTplName(e.target.value); setReview(null); }}>{templates.map((t) => <option key={t.name + t.language} value={t.name}>{t.name} ({t.language})</option>)}</select></label>
        {head.map((v, i) => <label key={'h' + i} className="master-field">Heading blank<input value={v} onChange={(e) => set('h', i, e.target.value, head)} maxLength={200} /></label>)}
        {body.map((v, i) => <label key={i} className="master-field">Blank {`{{${i + 1}}}`}<input value={v} onChange={(e) => set('b', i, e.target.value, body)} maxLength={400} placeholder={i === 0 ? 'Type {name} to use each person’s first name' : ''} /></label>)}
        <fieldset className="send-people"><legend>Who receives it</legend>
          <div className="type-chips">
            <button type="button" className={`type-chip ${everyone ? 'on' : ''}`} onClick={() => { setEveryone(!everyone); setReview(null); }}>Everyone saved</button>
            {tags.map((t) => <button type="button" key={t.tag} className={`type-chip ${selTags.has(t.tag) ? 'on' : ''}`} onClick={() => flip(selTags, t.tag, setSelTags)}>{t.tag}<span className="type-n">{t.n}</span></button>)}
            {groups.map((g) => <button type="button" key={g.name} className={`type-chip ${selGroups.has(g.name) ? 'on' : ''}`} onClick={() => flip(selGroups, g.name, setSelGroups)}>Group: {g.name}<span className="type-n">{g.count}</span></button>)}
          </div>
          <p className="mut small">People who opted out are always left out.</p>
        </fieldset>
      </div>
      <div className="send-col">
        {tpl && <WaPreview header={tpl.header} body={tpl.body} examples={body.map((v) => v.replace(/\{name\}/gi, 'Ravi') || '…')} headerExample={head[0] || '…'} />}
        {err && <p className="master-message master-error" role="alert">{err}</p>}
        {review && <div className="import-sum" aria-live="polite"><b>{review.will} {review.will === 1 ? 'person' : 'people'} will receive it</b>{review.optedOut > 0 && <> · {review.optedOut} left out (opted out)</>}<p className="mut small">Example: {review.sample}</p></div>}
        <div className="send-actions">
          <button className="btn" disabled={!ready || pending} onClick={doReview}>{pending && !review ? <Loader size="sm" label="" /> : null}Review</button>
          <button className="btn primary-ish" disabled={!ready || pending || !review || review.will === 0} onClick={create}>Create campaign</button>
        </div>
        <p className="mut small">Creating does not send anything. You start it on the next page.</p>
      </div>
    </div>
  );
}
