import { newScode, portalDecrypt, portalEncrypt } from './portalCrypto.js';
import type { RequestItemSnapshot } from './itemMaster.js';

export interface PortalSession { token: string; createdAt: Date; expiresAt: Date; }

export class PortalAuthError extends Error {}

const base = () => process.env.PORTAL_API_BASE ?? 'https://api-welfare.telangana.gov.in/WHMSGateWay/';

async function post(path: string, body: unknown) {
  const r = await fetch(base() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new PortalAuthError(`${path} returned HTTP ${r.status}`);
  return (await r.json()) as { success: boolean; data?: Record<string, string> };
}

/** Portal timestamps look like "2026-11-09 12:43:59.960131" and are in server-local time (IST), not UTC.
 *  Only use differences between two of them; never compare them to Date.now() directly. */
export const parsePortalTime = (s: string): Date => new Date(s.replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1') + 'Z');

/** Two-step login (login -> VerifyOTP). The portal returns the OTP inside the login response. */
export async function portalLogin(username: string, password: string): Promise<PortalSession> {
  let s = newScode();
  const l = await post('identity/api/auth/login', {
    scode: s, userid: portalEncrypt(username, s), password: portalEncrypt(password, s),
  });
  if (l.data?.scode !== s) throw new PortalAuthError('Login: session code mismatch');
  const status = portalDecrypt(l.data.status!, s);
  if (status !== '1') {
    throw new PortalAuthError(`Login rejected: ${portalDecrypt(l.data.message!, s)}`);
  }
  const otp = portalDecrypt(l.data.otp!, s);

  s = newScode();
  const v = await post('identity/api/auth/VerifyOTP', {
    scode: s, userid: portalEncrypt(username, s), otp: portalEncrypt(otp, s),
  });
  if (v.data?.scode !== s) throw new PortalAuthError('VerifyOTP: session code mismatch');
  if (portalDecrypt(v.data.status!, s) !== '1') {
    throw new PortalAuthError(`OTP rejected: ${portalDecrypt(v.data.message!, s)}`);
  }
  const lifetimeMs = parsePortalTime(portalDecrypt(v.data.expirydate!, s)).getTime() -
    parsePortalTime(portalDecrypt(v.data.createddate!, s)).getTime();
  const createdAt = new Date();
  return {
    token: portalDecrypt(v.data.token!, s),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + (lifetimeMs > 0 ? lifetimeMs : 0)),  // timezone-proof
  };
}

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: 'application/json' });

export async function fetchGodownMonth(token: string, godownId: number, monthName: string) {
  const q = new URLSearchParams({
    academicYear: 'All', societyId: 'All', districtId: '0', godownId: String(godownId), monthName,
  });
  const r = await fetch(`${base()}Mess/api/mess/GetRptGodownDetailed?${q}`, {
    headers: authHeaders(token), signal: AbortSignal.timeout(60_000),
  });
  if (r.status === 401) throw new PortalAuthError('Token rejected (401)');
  if (!r.ok) throw new Error(`GetRptGodownDetailed HTTP ${r.status}`);
  const j = (await r.json()) as { success: boolean; data?: Record<string, unknown>[] | { msg?: string } };
  if (Array.isArray(j.data)) return j.data;
  // An empty month comes back as {success:false, data:{status:0, msg:"No records found"}}
  if (!j.success && !Array.isArray(j.data) && /no records/i.test(j.data?.msg ?? '')) return [];
  throw new Error('GetRptGodownDetailed: unexpected response');
}

export async function fetchGodownsForUser(token: string, username: string): Promise<{ id: number; name: string }[]> {
  const r = await fetch(`${base()}Master/api/MessGodownMaster?p_user_id=${encodeURIComponent(username)}`, {
    headers: authHeaders(token), signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`MessGodownMaster HTTP ${r.status}`);
  const j = await r.json();
  const arr = Array.isArray(j) ? j : j?.data;
  if (!Array.isArray(arr)) throw new Error('MessGodownMaster: unexpected response');
  return arr as { id: number; name: string }[];
}

/** Every request for one month with its current stage (Pending, DC generated, in transit, received, variation, rejected, cancelled).
 *  The portal only filters by a single stage reliably when given "All", so we always ask for All and sort it out ourselves. */
export async function fetchGodownOrders(token: string, username: string, monthName: string, academicYear: string): Promise<Record<string, unknown>[]> {
  const q = new URLSearchParams({ id: username, status: 'All', month: monthName, academicYear });
  const r = await fetch(`${base()}Mess/api/mess/GetIndentHostelToVendorRequests?${q}`, {
    headers: authHeaders(token), signal: AbortSignal.timeout(60_000),
  });
  if (r.status === 401) throw new PortalAuthError('Token rejected (401)');
  if (!r.ok) throw new Error(`GetIndentHostelToVendorRequests HTTP ${r.status}`);
  const j = (await r.json()) as { success: boolean; data?: Record<string, unknown>[] | { msg?: string } };
  if (Array.isArray(j.data)) return j.data;
  if (/no records/i.test((j.data as { msg?: string } | undefined)?.msg ?? '')) return [];
  throw new Error('GetIndentHostelToVendorRequests: unexpected response');
}

/** One day of the portal's attendance report for a hostel: a row per class with its totals (nothing personal is requested or kept). */
export async function fetchAttendanceRows(token: string, hostelCode: string, date: string): Promise<{ total_students?: number; class_name?: string }[] | null> {
  const q = new URLSearchParams({ hostelId: hostelCode, date });
  const r = await fetch(`${base()}report/api/reports/GetRptAttendanceByHostel?${q}`, { headers: authHeaders(token), signal: AbortSignal.timeout(30_000) });
  if (r.status === 401) throw new PortalAuthError('Token rejected (401)');
  if (!r.ok) throw new Error(`GetRptAttendanceByHostel HTTP ${r.status}`);
  const j = (await r.json()) as { success?: boolean; data?: { total_students?: number; class_name?: string }[] };
  return Array.isArray(j.data) ? j.data : null;
}

const dayBefore = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
/** Fewer than this many students looks like a day with only some classes marked, so earlier days are looked at too. */
export const ENOUGH_STUDENTS = 100;

/** Number of students in a hostel: the sum of every class in the portal's attendance report.
 *  A day with only some classes marked would give a far too small number, so when today looks too small the previous six days are
 *  looked at too and the largest total is kept. (Only the totals are read. Names and other personal details are never requested or stored.) */
export async function fetchHostelStudents(token: string, hostelCode: string): Promise<number | null> {
  let best = 0;
  for (let back = 0; back < 7; back++) {
    const rows = await fetchAttendanceRows(token, hostelCode, dayBefore(back));
    const total = (rows ?? []).reduce((sum, row) => sum + (Number(row.total_students) || 0), 0);
    best = Math.max(best, total);
    if (best >= ENOUGH_STUDENTS) break;
  }
  return best > 0 ? best : null;
}

export interface PortalRequestItem extends Omit<RequestItemSnapshot, 'sourceKey'> {
  remarks?: string;
  supplierRemarks?: string;
  vendorRemarks?: string;
}

const portalText = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() || undefined : undefined;
const portalQuantity = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return undefined;
  const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Read-only item metadata endpoint. Whitelists business/item fields; no student data is retained. */
export async function fetchRequestItems(token: string, requestId: string): Promise<PortalRequestItem[]> {
  const path = 'GetIndentHostelToVendorRequestItems';
  const r = await fetch(`${base()}Mess/api/mess/${path}?requestId=${encodeURIComponent(requestId)}`, { method: 'GET', headers: authHeaders(token), signal: AbortSignal.timeout(30_000) });
  if (r.status === 401 || r.status === 403) throw new PortalAuthError(`Token rejected (${r.status})`);
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  const j = await r.json() as { success?: boolean; data?: unknown; msg?: unknown; message?: unknown };
  if (!j || typeof j !== 'object') throw new Error(`${path}: unexpected response`);
  const data = j.data as { msg?: unknown; message?: unknown } | undefined;
  const message = String(data?.msg ?? data?.message ?? j.msg ?? j.message ?? '');
  if (/unauthori[sz]ed|invalid token|token expired|session expired/i.test(message)) throw new PortalAuthError(`${path}: token rejected`);
  if (!Array.isArray(j.data)) {
    if (/no records/i.test(message)) return [];
    throw new Error(`${path}: unexpected response`);
  }
  if (j.success === false) {
    if (!j.data.length && /no records/i.test(message)) return [];
    throw new Error(`${path}: unsuccessful response`);
  }
  return j.data.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: invalid item row`);
    const row = value as Record<string, unknown>;
    const item: PortalRequestItem = { name: portalText(row.item_name) ?? '', requestedQuantity: portalQuantity(row.requested_quantity) ?? 0 };
    for (const [source, target] of [
      ['item_id', 'itemId'], ['uom', 'unit'], ['pack_size', 'packSize'], ['brand', 'brand'], ['item_category', 'category'],
      ['remarks', 'remarks'], ['supplier_remarks', 'supplierRemarks'], ['vendor_remarks', 'vendorRemarks'],
    ] as const) {
      const text = portalText(row[source]);
      if (text !== undefined) item[target] = text;
    }
    for (const [source, target] of [
      ['supplied_quantity', 'suppliedQuantity'], ['received_quantity', 'receivedQuantity'],
      ['variation_quantity', 'variationQuantity'], ['final_quantity', 'finalQuantity'],
    ] as const) {
      const quantity = portalQuantity(row[source]);
      if (quantity !== undefined) item[target] = quantity;
    }
    return item;
  });
}

/** The reason written when a request was cancelled/rejected (empty when none was given). */
export async function fetchRequestRemark(token: string, requestId: string): Promise<string | null> {
  const rows = await fetchRequestItems(token, requestId);
  for (const row of rows) for (const t of [row.remarks, row.supplierRemarks, row.vendorRemarks]) if (t?.trim()) return t.trim().slice(0, 400);
  return null;
}

export interface OrderSupplier { id: string; name: string; category?: string }

/** Read-only: which supplier a delivery note was made for. The portal's answer also carries the supplier's bank, PAN, phone and e-mail;
 *  none of that is read out of the response. Only the supplier's id, name and supply category are kept. */
export async function fetchOrderSupplier(token: string, requestId: string): Promise<OrderSupplier | null> {
  const path = 'GetVendorDtls';
  const r = await fetch(`${base()}Mess/api/mess/${path}?requestId=${encodeURIComponent(requestId)}`, { method: 'GET', headers: authHeaders(token), signal: AbortSignal.timeout(30_000) });
  if (r.status === 401 || r.status === 403) throw new PortalAuthError(`Token rejected (${r.status})`);
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  const j = await r.json() as { data?: unknown; msg?: unknown; message?: unknown };
  const message = String((j?.data as { msg?: unknown } | undefined)?.msg ?? j?.msg ?? j?.message ?? '');
  if (/unauthori[sz]ed|invalid token|token expired|session expired/i.test(message)) throw new PortalAuthError(`${path}: token rejected`);
  if (!Array.isArray(j?.data)) return null;
  const row = j.data[0] as Record<string, unknown> | undefined;
  const id = portalText(row?.vendor_id), name = portalText(row?.vendor_name);
  if (!id || !name) return null;
  const category = portalText(row?.supply_category_name);
  return { id, name, ...(category ? { category } : {}) };
}
