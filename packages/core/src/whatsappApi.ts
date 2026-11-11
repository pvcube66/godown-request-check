/** The only place that talks to WhatsApp (Meta Graph API). Adapted from the team's TELECRM CRM (`services/whatsappService.js`):
 *  Graph v24.0, template send, template create, template list, 30 second timeout. One business account, no per-company lookup. */

export const GRAPH_URL = 'https://graph.facebook.com/v24.0';
const TIMEOUT_MS = 30_000;

export interface WaCredentials { phoneNumberId: string; wabaId: string; accessToken: string }
export class WhatsAppApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}
export type Fetcher = typeof fetch;

async function call(f: Fetcher, url: string, init: RequestInit, token: string): Promise<Record<string, unknown>> {
  const res = await f(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON body */ }
  if (!res.ok) {
    const e = (body.error ?? {}) as { code?: number | string; message?: string };
    throw new WhatsAppApiError(`${e.code ?? res.status}: ${e.message ?? `HTTP ${res.status}`}`, String(e.code ?? res.status), res.status);
  }
  return body;
}

/** Sends one approved template with text values for {{1}}, {{2}}... Returns Meta's message id. */
export async function sendTemplateMessage(cred: WaCredentials, to: string, template: { name: string; language: string; headerParams?: string[] }, params: string[], f: Fetcher = fetch): Promise<string> {
  const body = await call(f, `${GRAPH_URL}/${encodeURIComponent(cred.phoneNumberId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name: template.name, language: { code: template.language }, components: [...(template.headerParams?.length ? [{ type: 'header', parameters: template.headerParams.map((text) => ({ type: 'text', text })) }] : []), ...(params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] : [])] },
    }),
  }, cred.accessToken);
  const id = (body.messages as { id?: string }[] | undefined)?.[0]?.id;
  if (!id) throw new WhatsAppApiError('Meta accepted the request but returned no message id', 'no-id', 200);
  return id;
}

export interface TemplateDef { name: string; language: string; category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'; bodyText: string; example: string[] }

/** Submits a body-only template for approval. */
export async function createTemplate(cred: WaCredentials, def: TemplateDef, f: Fetcher = fetch): Promise<{ id: string; status: string }> {
  const body = await call(f, `${GRAPH_URL}/${encodeURIComponent(cred.wabaId)}/message_templates`, {
    method: 'POST',
    body: JSON.stringify({ name: def.name, language: def.language, category: def.category, components: [{ type: 'BODY', text: def.bodyText, example: { body_text: [def.example] } }] }),
  }, cred.accessToken);
  return { id: String(body.id ?? ''), status: String(body.status ?? 'PENDING') };
}

/** The current approval state of one template (APPROVED, PENDING, REJECTED, ...), or null if Meta does not list it. */
export async function getTemplateStatus(cred: WaCredentials, name: string, language: string, f: Fetcher = fetch): Promise<{ status: string; reason: string } | null> {
  const url = `${GRAPH_URL}/${encodeURIComponent(cred.wabaId)}/message_templates?${new URLSearchParams({ name, fields: 'name,language,status,rejected_reason' })}`;
  const body = await call(f, url, { method: 'GET' }, cred.accessToken);
  const list = (body.data as { name: string; language: string; status: string; rejected_reason?: string }[] | undefined) ?? [];
  const hit = list.find((t) => t.name === name && t.language === language);
  return hit ? { status: hit.status, reason: hit.rejected_reason && hit.rejected_reason !== 'NONE' ? hit.rejected_reason : '' } : null;
}

/** A free-form text message. WhatsApp only allows this within 24 hours of the person's last message to us. */
export async function sendTextMessage(cred: WaCredentials, to: string, text: string, f: Fetcher = fetch): Promise<string> {
  const body = await call(f, `${GRAPH_URL}/${encodeURIComponent(cred.phoneNumberId)}/messages`, {
    method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: false } }),
  }, cred.accessToken);
  const id = (body.messages as { id?: string }[] | undefined)?.[0]?.id;
  if (!id) throw new WhatsAppApiError('Meta accepted the request but returned no message id', 'no-id', 200);
  return id;
}
