'use client';
import { useMemo, useRef, useState, useTransition } from 'react';
import { SEND_OUTCOME_TEXT, type SendSummary } from '@anomaly/core/send-rules';
import { variablesIn } from '@anomaly/core/template-rules';
import Loader from '@/components/Loader';
import WaPreview from '@/components/WaPreview';
import { showToast } from '@/components/toast';
import { sendAction } from './actions';

interface Tpl { name: string; language: string; body: string; header: string; footer: string; examples: string[]; headerExample: string }
const newBatch = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

export default function SendClient({ mode, templates, contacts, groups, initial }: { mode: string; templates: Tpl[]; contacts: { phone: string; name: string }[]; groups: { name: string; count: number }[]; initial: { to: string; group: string; template: string } }) {
  const [kind, setKind] = useState<'template' | 'text'>('template');
  const [tplKey, setTplKey] = useState(templates.find((t) => t.name === initial.template)?.name ?? templates[0]?.name ?? '');
  const tpl = templates.find((t) => t.name === tplKey);
  const nBody = tpl ? variablesIn(tpl.body).length : 0, nHead = tpl ? variablesIn(tpl.header).length : 0;
  const [vals, setVals] = useState<Record<string, string[]>>({});
  const body = (vals[tplKey + ':b'] ?? []).concat(Array(nBody).fill('')).slice(0, nBody);
  const head = (vals[tplKey + ':h'] ?? []).concat(Array(nHead).fill('')).slice(0, nHead);
  const [text, setText] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set(initial.to ? [initial.to] : []));
  const [grp, setGrp] = useState<Set<string>>(new Set(initial.group ? [initial.group] : []));
  const [q, setQ] = useState('');
  const [sum, setSum] = useState<SendSummary | null>(null);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const batch = useRef(newBatch());

  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return (t ? contacts.filter((c) => c.name.toLowerCase().includes(t) || c.phone.includes(t.replace(/\D/g, '') || '\u0000')) : contacts).slice(0, 100); }, [q, contacts]);
  const people = sel.size + [...grp].reduce((n, g) => n + (groups.find((x) => x.name === g)?.count ?? 0), 0);
  const toggle = <T,>(set: Set<T>, v: T, put: (s: Set<T>) => void) => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); put(n); setSum(null); };
  const setBody = (i: number, v: string) => { const n = [...body]; n[i] = v; setVals({ ...vals, [tplKey + ':b']: n }); setSum(null); };
  const setHead = (i: number, v: string) => { const n = [...head]; n[i] = v; setVals({ ...vals, [tplKey + ':h']: n }); setSum(null); };

  const run = (preview: boolean) => {
    setErr('');
    start(async () => {
      const r = await sendAction({ kind, ...(kind === 'template' && tpl ? { template: { name: tpl.name, language: tpl.language }, body, header: head } : { text }), phones: [...sel], groups: [...grp], batchId: batch.current }, preview);
      if (!r.ok) { setErr(r.message); return; }
      setSum(r.summary);
      if (!preview) { showToast({ message: `${r.summary.sent} sent${r.summary.failed ? `, ${r.summary.failed} not sent` : ''}.` }); batch.current = newBatch(); }
    });
  };
  const filled = kind === 'text' ? text.trim().length > 0 : !!tpl && body.every((v) => v.trim()) && head.every((v) => v.trim());
  const ready = filled && people > 0;
  const live = mode === 'live';
  const counts = sum ? { ok: sum.results.filter((r) => r.outcome === 'would_send' || r.outcome === 'sent').length, skip: sum.results.length - sum.results.filter((r) => r.outcome === 'would_send' || r.outcome === 'sent').length } : null;

  return (
    <div className="send-grid">
      <div className="send-col">
        <nav className="seg" aria-label="What to send">
          <button className={kind === 'template' ? 'on' : ''} onClick={() => { setKind('template'); setSum(null); }}>Template</button>
          <button className={kind === 'text' ? 'on' : ''} onClick={() => { setKind('text'); setSum(null); }}>Reply (within 24 hours)</button>
        </nav>
        {kind === 'template' ? (templates.length === 0 ? <div className="empty">No approved templates yet. Create one under Templates and wait for WhatsApp to approve it.</div> : (
          <>
            <label className="master-field">Template<select value={tplKey} onChange={(e) => { setTplKey(e.target.value); setSum(null); }}>{templates.map((t) => <option key={t.name + t.language} value={t.name}>{t.name} ({t.language})</option>)}</select></label>
            {head.map((v, i) => <label key={'h' + i} className="master-field">Heading blank<input value={v} onChange={(e) => setHead(i, e.target.value)} maxLength={200} /></label>)}
            {body.map((v, i) => <label key={i} className="master-field">Blank {`{{${i + 1}}}`}<input value={v} onChange={(e) => setBody(i, e.target.value)} maxLength={400} placeholder={i === 0 ? 'Type {name} to use each person’s first name' : ''} /></label>)}
          </>
        )) : (
          <label className="master-field">Message<textarea rows={5} value={text} maxLength={4000} onChange={(e) => { setText(e.target.value); setSum(null); }} placeholder="Only people who wrote to you in the last 24 hours receive this." /></label>
        )}

        <fieldset className="send-people"><legend>To</legend>
          {groups.length > 0 && <div className="type-chips">{groups.map((g) => <button type="button" key={g.name} className={`type-chip ${grp.has(g.name) ? 'on' : ''}`} onClick={() => toggle(grp, g.name, setGrp)}>Group: {g.name}<span className="type-n">{g.count}</span></button>)}</div>}
          <input className="plain-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search saved people" aria-label="Search saved people" />
          <ul className="pick-list">{shown.map((c) => <li key={c.phone}><label><input type="checkbox" checked={sel.has(c.phone)} onChange={() => toggle(sel, c.phone, setSel)} /> <b>{c.name || 'No name'}</b> <span className="mut small">+{c.phone}</span></label></li>)}{shown.length === 0 && <li className="mut small">{contacts.length === 0 ? 'No one is saved yet. Add people under People.' : 'No one matches.'}</li>}</ul>
          <p className="mut small">{people} chosen{people > 50 ? ' (too many: send up to 50 at a time)' : ''}</p>
        </fieldset>
      </div>

      <div className="send-col">
        {kind === 'template' && tpl && <WaPreview header={tpl.header} body={tpl.body} examples={body.map((v) => v.replace(/\{name\}/gi, 'Ravi') || '…')} footer={tpl.footer} headerExample={head[0] || '…'} />}
        {kind === 'text' && <WaPreview body={text} />}
        {err && <p className="master-message master-error" role="alert">{err}</p>}
        <div className="send-actions">
          <button className="btn" disabled={!ready || pending} onClick={() => run(true)}>{pending ? <Loader size="sm" label="" /> : null}Preview who gets it</button>
          <button className="btn primary-ish" disabled={!ready || pending || !live || !sum || !sum.preview || people > 50} title={live ? '' : 'Switch WhatsApp to live to send'} onClick={() => { if (confirm(`Send this message to ${counts?.ok ?? 0} ${counts?.ok === 1 ? 'person' : 'people'} now?`)) run(false); }}>Send to {counts?.ok ?? '…'}</button>
        </div>
        {sum && (
          <div className="import-sum" aria-live="polite">
            <b>{sum.preview ? `Preview: ${counts!.ok} would receive it` : `${sum.sent} sent`}</b>{counts!.skip > 0 && <> · {counts!.skip} {sum.preview ? 'skipped' : 'not sent'}</>}
            {sum.stopped && <p className="bad-text">Sending stopped: {sum.stopped}.</p>}
            <ul>{sum.results.map((r) => <li key={r.phone}>{r.name || `+${r.phone}`}: {SEND_OUTCOME_TEXT[r.outcome]}{r.note ? ` (${r.note})` : ''}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}
