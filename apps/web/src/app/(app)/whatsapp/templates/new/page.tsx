import { ensureWhatsAppSettings, isConnected, type TemplateButton, type TemplateForm, type WaTemplateDoc } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { masterAdminAccess } from '@/lib/master-auth';
import TemplateEditor from './TemplateEditor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create template' };

const EMPTY: TemplateForm = { name: '', language: 'en', category: 'UTILITY', headerText: '', body: '', examples: [], headerExample: '', footer: '', buttons: [] };

/** A template that only exists on WhatsApp has no typed form; rebuild one from its parts. */
function formFromDoc(d: WaTemplateDoc): TemplateForm {
  if (d.form) return d.form;
  const comps = d.components as { type: string; text?: string; format?: string; buttons?: { type: string; text: string; url?: string; phone_number?: string }[]; example?: { body_text?: string[][]; header_text?: string[] } }[];
  const get = (t: string) => comps.find((c) => c.type === t);
  return {
    name: d.name, language: d.language, category: d.category === 'MARKETING' ? 'MARKETING' : 'UTILITY',
    headerText: get('HEADER')?.format === 'TEXT' ? get('HEADER')?.text ?? '' : '', headerExample: get('HEADER')?.example?.header_text?.[0] ?? '',
    body: get('BODY')?.text ?? d.bodyText, examples: get('BODY')?.example?.body_text?.[0] ?? [], footer: get('FOOTER')?.text ?? '',
    buttons: (get('BUTTONS')?.buttons ?? []).filter((b) => ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(b.type)).map((b): TemplateButton => ({ type: b.type as TemplateButton['type'], text: b.text, ...(b.url ? { url: b.url.replace(/\{\{\d+\}\}$/, '') } : {}), ...(b.phone_number ? { phone_number: b.phone_number } : {}) })),
  };
}

export default async function NewTemplate({ searchParams }: { searchParams: Promise<{ from?: string; lang?: string; draft?: string }> }) {
  if (!(await masterAdminAccess()).authorized) return <div className="master-page"><header className="master-header"><h1>Create template</h1></header><section className="master-section master-gate"><h2>Administrators only</h2></section></div>;
  const sp = await searchParams;
  const c = await getDb();
  let initial = EMPTY;
  if (sp.from) {
    const d = await c.waTemplates.findOne({ name: sp.from.slice(0, 512), language: (sp.lang ?? 'en').slice(0, 10) });
    if (d) { const f = formFromDoc(d); initial = sp.draft === '1' ? f : { ...f, name: `${f.name}_copy`.slice(0, 512) }; }
  }
  return (
    <>
      <section className="hero"><h1>{sp.draft === '1' ? 'Edit draft' : sp.from ? 'Duplicate template' : 'Create template'}</h1></section>
      <TemplateEditor initial={initial} connected={isConnected(await ensureWhatsAppSettings(c))} />
    </>
  );
}
