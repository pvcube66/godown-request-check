import { newScode, portalDecrypt, portalEncrypt } from './portalCrypto.js';

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

/** Number of students in a hostel: the sum of every class in the portal's attendance report.
 *  (Only the totals are read. Student names and other personal details are never requested or stored.) */
export async function fetchHostelStudents(token: string, hostelCode: string): Promise<number | null> {
  const today = new Date().toISOString().slice(0, 10);
  const q = new URLSearchParams({ hostelId: hostelCode, date: today });
  const r = await fetch(`${base()}report/api/reports/GetRptAttendanceByHostel?${q}`, { headers: authHeaders(token), signal: AbortSignal.timeout(30_000) });
  if (r.status === 401) throw new PortalAuthError('Token rejected (401)');
  if (!r.ok) throw new Error(`GetRptAttendanceByHostel HTTP ${r.status}`);
  const j = (await r.json()) as { success?: boolean; data?: { total_students?: number }[] };
  if (!Array.isArray(j.data)) return null;
  const total = j.data.reduce((s, row) => s + (Number(row.total_students) || 0), 0);
  return total > 0 ? total : null;
}

/** The reason written when a request was cancelled/rejected (empty when none was given). Reads only the free-text remarks. */
export async function fetchRequestRemark(token: string, requestId: string): Promise<string | null> {
  const r = await fetch(`${base()}Mess/api/mess/GetIndentHostelToVendorRequestItems?requestId=${encodeURIComponent(requestId)}`, { headers: authHeaders(token), signal: AbortSignal.timeout(30_000) });
  if (r.status === 401) throw new PortalAuthError('Token rejected (401)');
  if (!r.ok) return null;
  const j = (await r.json()) as { data?: { remarks?: string | null; supplier_remarks?: string | null; vendor_remarks?: string | null }[] };
  const rows = Array.isArray(j.data) ? j.data : [];
  for (const row of rows) for (const t of [row.remarks, row.supplier_remarks, row.vendor_remarks]) if (t && t.trim()) return t.trim().slice(0, 400);
  return null;
}
