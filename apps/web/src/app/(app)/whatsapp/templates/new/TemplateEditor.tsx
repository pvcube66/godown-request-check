'use client';
import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CATEGORIES, CATEGORY_TEXT, LANGUAGES, validateTemplate, variablesIn, type TemplateButton, type TemplateForm } from '@anomaly/core/template-rules';
import Loader from '@/components/Loader';
import WaPreview from '@/components/WaPreview';
import { showToast } from '@/components/toast';
import { saveDraftAction, submitTemplateFormAction } from '../actions';

const BUTTON_LABEL = { QUICK_REPLY: 'Quick reply', URL: 'Website', PHONE_NUMBER: 'Call' } as const;

export default function TemplateEditor({ initial, connected }: { initial: TemplateForm; connected: boolean }) {
  const [f, setF] = useState<TemplateForm>(initial);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<'draft' | 'send' | null>(null);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  const vars = variablesIn(f.body);
  const problems = useMemo(() => validateTemplate(f), [f]);
  const set = <K extends keyof TemplateForm>(k: K, v: TemplateForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const setExample = (i: number, v: string) => setF((p) => { const ex = [...p.examples]; while (ex.length <= i) ex.push(''); ex[i] = v; return { ...p, examples: ex }; });
  const setButton = (i: number, patch: Partial<TemplateButton>) => setF((p) => ({ ...p, buttons: p.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));

  const addVariable = () => {
    const n = (vars.at(-1) ?? 0) + 1;
    const el = bodyRef.current;
    const at = el?.selectionStart ?? f.body.length;
    set('body', `${f.body.slice(0, at)}{{${n}}}${f.body.slice(at)}`);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + String(n).length + 4, at + String(n).length + 4); });
  };

  const go = (kind: 'draft' | 'send') => {
    setTouched(true); setError('');
    if (kind === 'send' && problems.length) { setError(problems[0]!); return; }
    setBusy(kind);
    start(async () => {
      const r = await (kind === 'draft' ? saveDraftAction(f) : submitTemplateFormAction(f));
      setBusy(null);
      if (!r.ok) { setError(r.message); return; }
      showToast({ message: r.message });
      router.push('/whatsapp/templates');
    });
  };

  return (
    <div className="tpl-editor">
      <div className="tpl-form">
        <section className="wiz-card">
          <h3>Basics</h3>
          <label className="master-field">Template name<input value={f.name} onChange={(e) => set('name', e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_'))} placeholder="delivery_update" maxLength={512} /></label>
          <div className="master-fields">
            <label className="master-field">Category<select value={f.category} onChange={(e) => set('category', e.target.value as TemplateForm['category'])}>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_TEXT[c]}</option>)}</select></label>
            <label className="master-field">Language<select value={f.language} onChange={(e) => set('language', e.target.value)}>{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select></label>
          </div>
        </section>

        <section className="wiz-card">
          <h3>Message</h3>
          <label className="master-field">Header <span className="mut">(optional, up to 60 characters)</span><input value={f.headerText} onChange={(e) => set('headerText', e.target.value)} maxLength={60} /></label>
          {variablesIn(f.headerText).length > 0 && <label className="master-field">Example for the header variable {'{{1}}'}<input value={f.headerExample} onChange={(e) => set('headerExample', e.target.value)} maxLength={100} /></label>}
          <label className="master-field">Text
            <textarea ref={bodyRef} rows={6} value={f.body} onChange={(e) => set('body', e.target.value)} maxLength={1024} placeholder="Hello {{1}}, your delivery {{2}} is on the way. Thank you." />
          </label>
          <div className="tpl-body-tools"><button type="button" className="btn" onClick={addVariable}>Add variable</button><span className="mut small">{f.body.length}/1024</span></div>
          {vars.length > 0 && (
            <div className="tpl-examples">
              <p className="mut small">WhatsApp reviews your template with an example for each variable.</p>
              {vars.map((n, i) => <label key={n} className="master-field">Example for {`{{${n}}}`}<input value={f.examples[i] ?? ''} onChange={(e) => setExample(i, e.target.value)} maxLength={100} /></label>)}
            </div>
          )}
          <label className="master-field">Footer <span className="mut">(optional, up to 60 characters)</span><input value={f.footer} onChange={(e) => set('footer', e.target.value)} maxLength={60} /></label>
        </section>

        <section className="wiz-card">
          <h3>Buttons <span className="mut small">(optional)</span></h3>
          {f.buttons.map((b, i) => (
            <div className="tpl-button" key={i}>
              <b>{BUTTON_LABEL[b.type]}</b>
              <input value={b.text} onChange={(e) => setButton(i, { text: e.target.value })} placeholder="Button text" maxLength={25} aria-label="Button text" />
              {b.type === 'URL' && <input value={b.url ?? ''} onChange={(e) => setButton(i, { url: e.target.value })} placeholder="https://example.com" aria-label="Website" />}
              {b.type === 'PHONE_NUMBER' && <input value={b.phone_number ?? ''} onChange={(e) => setButton(i, { phone_number: e.target.value })} placeholder="+919876543210" aria-label="Phone number" />}
              <button type="button" className="btn" onClick={() => set('buttons', f.buttons.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <div className="tpl-body-tools">
            {(['QUICK_REPLY', 'URL', 'PHONE_NUMBER'] as const).map((t) => <button key={t} type="button" className="btn" onClick={() => set('buttons', [...f.buttons, { type: t, text: '' }])}>Add {BUTTON_LABEL[t].toLowerCase()} button</button>)}
          </div>
        </section>
      </div>

      <aside className="tpl-side">
        <div className="wiz-card">
          <h3>Preview</h3>
          <WaPreview header={f.headerText} headerExample={f.headerExample} body={f.body} examples={f.examples} footer={f.footer} buttons={f.buttons} />
        </div>
        {touched && problems.length > 0 && <ul className="tpl-problems" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        {error && <p className="master-message master-error" role="alert">{error}</p>}
        {!connected && <p className="mut small">WhatsApp is not connected, so only drafts can be saved. <Link href="/whatsapp/connect">Connect WhatsApp</Link></p>}
        <div className="tpl-actions">
          <button className="btn" disabled={pending || !f.name} onClick={() => go('draft')}>{busy === 'draft' ? <Loader size="sm" label="" /> : null}Save draft</button>
          <button className="btn primary-ish" disabled={pending || !connected} onClick={() => go('send')}>{busy === 'send' ? <Loader size="sm" label="" /> : null}Send for approval</button>
        </div>
        <Link href="/whatsapp/templates" className="link-arrow">Cancel</Link>
      </aside>
    </div>
  );
}
