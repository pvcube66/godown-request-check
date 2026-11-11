/** The rules and shapes of a message template. Pure (no database, no network), so the browser can use them too. */
export const CATEGORIES = ['UTILITY', 'MARKETING'] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_TEXT: Record<Category, string> = { UTILITY: 'Utility (updates about an existing order)', MARKETING: 'Marketing (offers and announcements)' };
export const LANGUAGES: { code: string; label: string }[] = [{ code: 'en', label: 'English' }, { code: 'te', label: 'Telugu' }, { code: 'hi', label: 'Hindi' }, { code: 'en_US', label: 'English (US)' }];

export interface TemplateButton { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phone_number?: string }
export interface TemplateForm {
  name: string; language: string; category: Category;
  headerText: string;            // '' = no header
  body: string;
  examples: string[];            // one example per {{n}} in the body, in order
  headerExample: string;         // when the header has {{1}}
  footer: string;
  buttons: TemplateButton[];
}

export type TemplateStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'IN_APPEAL' | 'PENDING_DELETION' | string;
const VAR = /\{\{(\d+)\}\}/g;
export const variablesIn = (text: string): number[] => [...new Set([...text.matchAll(VAR)].map((m) => Number(m[1])))].sort((a, b) => a - b);

/** Meta's template rules, in plain words. Returns every problem found. */
export function validateTemplate(f: TemplateForm): string[] {
  const errs: string[] = [];
  if (!/^[a-z][a-z0-9_]{0,511}$/.test(f.name)) errs.push('The name uses lower-case letters, numbers and underscores only, and starts with a letter (for example delivery_update).');
  if (!LANGUAGES.some((l) => l.code === f.language) && !/^[a-z]{2}(_[A-Z]{2})?$/.test(f.language)) errs.push('Choose a language.');
  if (!(CATEGORIES as readonly string[]).includes(f.category)) errs.push('Choose a category.');
  const body = f.body.trim();
  if (!body) errs.push('Write the message text.');
  if (body.length > 1024) errs.push('The message text is longer than 1024 characters.');
  const vars = variablesIn(body);
  if (vars.some((n, i) => n !== i + 1)) errs.push('Variables must be numbered in order: {{1}}, {{2}}, {{3}} with none missing.');
  if (/^\s*\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}\s*[.!?]*\s*$/.test(body)) errs.push('The message cannot start or end with a variable. Add some words before the first and after the last.');
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)) errs.push('Two variables cannot sit next to each other. Put a word between them.');
  if (vars.length && (f.examples.length < vars.length || f.examples.slice(0, vars.length).some((e) => !e.trim()))) errs.push('Give an example value for every variable. WhatsApp asks for them when it reviews the template.');
  if (f.examples.some((e) => /[\n\t]/.test(e) || / {5,}/.test(e))) errs.push('Example values cannot contain line breaks, tabs or long runs of spaces.');
  if (f.headerText.trim()) {
    if (f.headerText.trim().length > 60) errs.push('The header is longer than 60 characters.');
    const hv = variablesIn(f.headerText);
    if (hv.length > 1 || (hv.length === 1 && hv[0] !== 1)) errs.push('The header can have at most one variable, {{1}}.');
    if (hv.length === 1 && !f.headerExample.trim()) errs.push('Give an example value for the header variable.');
  }
  if (f.footer.trim().length > 60) errs.push('The footer is longer than 60 characters.');
  if (/\{\{/.test(f.footer)) errs.push('The footer cannot contain variables.');
  const quick = f.buttons.filter((b) => b.type === 'QUICK_REPLY'), urls = f.buttons.filter((b) => b.type === 'URL'), phones = f.buttons.filter((b) => b.type === 'PHONE_NUMBER');
  if (quick.length > 3) errs.push('At most 3 quick-reply buttons.');
  if (urls.length > 2) errs.push('At most 2 website buttons.');
  if (phones.length > 1) errs.push('At most 1 call button.');
  if (f.buttons.length > 10) errs.push('Too many buttons.');
  for (const b of f.buttons) {
    if (!b.text.trim() || b.text.trim().length > 25) errs.push('Each button needs text of 1 to 25 characters.');
    if (b.type === 'URL' && !/^https:\/\/\S+$/.test(b.url ?? '')) errs.push(`The website for “${b.text}” must start with https://`);
    if (b.type === 'PHONE_NUMBER' && !/^\+\d{8,15}$/.test(b.phone_number ?? '')) errs.push(`The phone number for “${b.text}” must look like +919876543210.`);
  }
  return [...new Set(errs.filter(Boolean))];
}

/** The components Meta wants for a template submission. */
export function buildComponents(f: TemplateForm): Record<string, unknown>[] {
  const comps: Record<string, unknown>[] = [];
  const header = f.headerText.trim();
  if (header) comps.push({ type: 'HEADER', format: 'TEXT', text: header, ...(variablesIn(header).length ? { example: { header_text: [f.headerExample.trim()] } } : {}) });
  const body = f.body.trim(), n = variablesIn(body).length;
  comps.push({ type: 'BODY', text: body, ...(n ? { example: { body_text: [f.examples.slice(0, n).map((e) => e.trim())] } } : {}) });
  if (f.footer.trim()) comps.push({ type: 'FOOTER', text: f.footer.trim() });
  if (f.buttons.length) comps.push({ type: 'BUTTONS', buttons: f.buttons.map((b) => (b.type === 'URL' ? { type: 'URL', text: b.text.trim(), url: b.url } : b.type === 'PHONE_NUMBER' ? { type: 'PHONE_NUMBER', text: b.text.trim(), phone_number: b.phone_number } : { type: 'QUICK_REPLY', text: b.text.trim() })) });
  return comps;
}

export const STATUS_TEXT: Record<string, string> = { APPROVED: 'Approved', PENDING: 'Waiting for approval', REJECTED: 'Rejected', DRAFT: 'Draft (not sent)', PAUSED: 'Paused', DISABLED: 'Disabled', IN_APPEAL: 'In appeal' };
/** What the phone preview shows: the body with sample values filled in. */
export const previewText = (text: string, examples: readonly string[]) => text.replace(VAR, (_m, n: string) => examples[Number(n) - 1]?.trim() || `{{${n}}}`);
