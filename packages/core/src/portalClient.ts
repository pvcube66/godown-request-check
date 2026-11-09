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

/** Portal timestamps look like "2026-11-09 12:43:59.960131" and are UTC. */
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
  return {
    token: portalDecrypt(v.data.token!, s),
    createdAt: parsePortalTime(portalDecrypt(v.data.createddate!, s)),
    expiresAt: parsePortalTime(portalDecrypt(v.data.expirydate!, s)),
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
  const j = (await r.json()) as { success: boolean; data?: Record<string, unknown>[] };
  if (!j.success || !Array.isArray(j.data)) throw new Error('GetRptGodownDetailed: unexpected response');
  return j.data;
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
