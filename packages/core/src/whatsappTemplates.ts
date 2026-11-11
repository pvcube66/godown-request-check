import type { Collection } from 'mongodb';
import type { AuditDoc } from './masterData.js';
import type { Collections } from './db.js';
import { credentialsOf, WhatsAppInputError, type WhatsAppSettings } from './whatsapp.js';
import { GRAPH_URL, WhatsAppApiError, type Fetcher, type WaCredentials } from './whatsappApi.js';
import { buildComponents, validateTemplate, variablesIn, type TemplateForm, type TemplateStatus } from './whatsappTemplateRules.js';
export * from './whatsappTemplateRules.js';

/** Message templates: create, submit for approval, list, sync and delete. Follows the TeleCRM's template page (name, category, language,
 *  header, body with variables and examples, footer, buttons), without its AI helpers or media headers. */

export interface WaTemplateDoc {
  name: string; language: string; category: string; status: TemplateStatus;
  form: TemplateForm | null;     // what was typed (null when it only exists on Meta)
  components: unknown[];         // what Meta has
  bodyText: string; variables: number;
  metaId: string | null; reason: string | null;
  createdAt: Date; updatedAt: Date; syncedAt: Date | null;
}
export interface TemplateCollections extends Pick<Collections, 'settings' | 'auditLog'> { waTemplates: Collection<WaTemplateDoc> }

async function graph(f: Fetcher, url: string, token: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await f(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON */ }
  if (!res.ok) { const e = (body.error ?? {}) as { code?: number | string; message?: string; error_user_msg?: string }; throw new WhatsAppApiError(`${e.code ?? res.status}: ${e.error_user_msg ?? e.message ?? `HTTP ${res.status}`}`, String(e.code ?? res.status), res.status); }
  return body;
}

interface MetaTemplate { id: string; name: string; language: string; category: string; status: string; components?: { type: string; text?: string }[]; rejected_reason?: string }
export async function listMetaTemplates(cred: WaCredentials, f: Fetcher = fetch): Promise<MetaTemplate[]> {
  const out: MetaTemplate[] = [];
  let url: string | null = `${GRAPH_URL}/${encodeURIComponent(cred.wabaId)}/message_templates?${new URLSearchParams({ limit: '100', fields: 'id,name,language,category,status,components,rejected_reason' })}`;
  for (let page = 0; url && page < 20; page++) {
    const body = await graph(f, url, cred.accessToken);
    out.push(...((body.data as MetaTemplate[] | undefined) ?? []));
    url = ((body.paging as { next?: string } | undefined)?.next) ?? null;
  }
  return out;
}

const bodyOf = (components: { type: string; text?: string }[] | undefined) => components?.find((c) => c.type === 'BODY')?.text ?? '';
const audit = (c: TemplateCollections, actor: string, action: string, target: string, details?: unknown) =>
  c.auditLog.insertOne({ actor, action, target, at: new Date(), ...(details === undefined ? {} : { details }) });

function needCred(s: WhatsAppSettings): WaCredentials {
  const cred = credentialsOf(s);
  if (!cred) throw new WhatsAppInputError('Connect WhatsApp first.');
  return cred;
}

/** Brings our list in line with Meta: new and changed templates are saved, ones removed on Meta disappear. Drafts are never touched. */
export async function syncTemplates(c: TemplateCollections, s: WhatsAppSettings, f: Fetcher = fetch, now = new Date()): Promise<{ total: number; removed: number }> {
  const metas = await listMetaTemplates(needCred(s), f);
  const seen = new Set<string>();
  for (const m of metas) {
    if (String(m.status).toUpperCase() === 'PENDING_DELETION') continue;
    seen.add(`${m.name}|${m.language}`);
    const body = bodyOf(m.components);
    await c.waTemplates.updateOne({ name: m.name, language: m.language }, {
      $set: { category: m.category, status: m.status, components: m.components ?? [], bodyText: body, variables: variablesIn(body).length, metaId: m.id, reason: m.rejected_reason && m.rejected_reason !== 'NONE' ? m.rejected_reason : null, updatedAt: now, syncedAt: now },
      $setOnInsert: { name: m.name, language: m.language, form: null, createdAt: now },
    }, { upsert: true });
  }
  const local = await c.waTemplates.find({ status: { $ne: 'DRAFT' } }, { projection: { name: 1, language: 1 } }).toArray();
  const gone = local.filter((t) => !seen.has(`${t.name}|${t.language}`));
  for (const t of gone) await c.waTemplates.deleteOne({ name: t.name, language: t.language });
  return { total: metas.length, removed: gone.length };
}

/** Saves what was typed without sending it to Meta. */
export async function saveDraft(c: TemplateCollections, form: TemplateForm, actor: string, now = new Date()): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,511}$/.test(form.name)) throw new WhatsAppInputError('The name uses lower-case letters, numbers and underscores only.');
  const existing = await c.waTemplates.findOne({ name: form.name, language: form.language });
  if (existing && existing.status !== 'DRAFT') throw new WhatsAppInputError('A template with this name and language already exists on WhatsApp. Choose another name.');
  const body = form.body.trim();
  await c.waTemplates.updateOne({ name: form.name, language: form.language }, { $set: { category: form.category, status: 'DRAFT', form, components: buildComponents(form), bodyText: body, variables: variablesIn(body).length, reason: null, updatedAt: now }, $setOnInsert: { name: form.name, language: form.language, metaId: null, createdAt: now, syncedAt: null } }, { upsert: true });
  await audit(c, actor, 'whatsapp.template.draft', form.name);
}

/** Sends a template to WhatsApp for approval. */
export async function submitTemplate(c: TemplateCollections, s: WhatsAppSettings, form: TemplateForm, actor: string, f: Fetcher = fetch, now = new Date()): Promise<{ id: string; status: string }> {
  const errors = validateTemplate(form);
  if (errors.length) throw new WhatsAppInputError(errors[0]!);
  const cred = needCred(s);
  const existing = await c.waTemplates.findOne({ name: form.name, language: form.language });
  if (existing && existing.status !== 'DRAFT') throw new WhatsAppInputError('A template with this name and language already exists. Choose another name.');
  const body = await graph(f, `${GRAPH_URL}/${encodeURIComponent(cred.wabaId)}/message_templates`, cred.accessToken, { method: 'POST', body: JSON.stringify({ name: form.name, language: form.language, category: form.category, components: buildComponents(form) }) });
  const result = { id: String(body.id ?? ''), status: String(body.status ?? 'PENDING') };
  const text = form.body.trim();
  await c.waTemplates.updateOne({ name: form.name, language: form.language }, { $set: { category: form.category, status: result.status, form, components: buildComponents(form), bodyText: text, variables: variablesIn(text).length, metaId: result.id, reason: null, updatedAt: now, syncedAt: now }, $setOnInsert: { name: form.name, language: form.language, createdAt: now } }, { upsert: true });
  await audit(c, actor, 'whatsapp.template.submit', form.name, { status: result.status });
  return result;
}

/** Deletes a template on WhatsApp (every language of that name) and here. Drafts are only removed here. */
export async function removeTemplate(c: TemplateCollections, s: WhatsAppSettings, name: string, language: string, actor: string, f: Fetcher = fetch): Promise<void> {
  const t = await c.waTemplates.findOne({ name, language });
  if (!t) throw new WhatsAppInputError('That template no longer exists.');
  if (t.status !== 'DRAFT') {
    const cred = needCred(s);
    await graph(f, `${GRAPH_URL}/${encodeURIComponent(cred.wabaId)}/message_templates?${new URLSearchParams({ name })}`, cred.accessToken, { method: 'DELETE' });
  }
  await c.waTemplates.deleteMany({ name, ...(t.status === 'DRAFT' ? { language } : {}) });
  await audit(c, actor, 'whatsapp.template.delete', name);
}


