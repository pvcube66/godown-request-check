import crypto from 'node:crypto';

export const MASTER_COOKIE = 'master_admin_session';
export function masterAdminConfigured(): boolean {
  const secret = process.env.MASTER_ADMIN_PASSWORD;
  return !!secret && secret.length >= 16 && secret !== process.env.DASHBOARD_PASSWORD && !!process.env.DASHBOARD_PASSWORD;
}
const digest = (value: string) => crypto.createHash('sha256').update(value).digest();
const equal = (a: string, b: string) => crypto.timingSafeEqual(digest(a), digest(b));
export function checkMasterPassword(password: string): boolean {
  return masterAdminConfigured() && password.length <= 1024 && equal(password, process.env.MASTER_ADMIN_PASSWORD!);
}
const sign = (expiry: string, dashboardSession: string) => crypto.createHmac('sha256', process.env.MASTER_ADMIN_PASSWORD!).update(`${expiry}|${dashboardSession}`).digest('base64url');
export function makeMasterSession(dashboardSession: string, now = Date.now()): string {
  if (!masterAdminConfigured() || !dashboardSession) throw new Error('Master admin is not configured');
  const expiry = String(now + 3600000);
  return `${expiry}.${sign(expiry, dashboardSession)}`;
}
export function verifyMasterSession(value: string | undefined, dashboardSession: string, now = Date.now()): boolean {
  if (!masterAdminConfigured() || !value || !dashboardSession) return false;
  const parts = value.split('.');
  const [expiry, signature] = parts;
  if (parts.length !== 2 || !expiry || !signature || !/^\d+$/.test(expiry) || Number(expiry) <= now || Number(expiry) > now + 3600000) return false;
  return equal(signature, sign(expiry, dashboardSession));
}
