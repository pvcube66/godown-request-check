import crypto from 'node:crypto';

export const SESSION_COOKIE = 'anomaly_session';
const key = () => crypto.createHash('sha256').update(`${process.env.DASHBOARD_PASSWORD}|${process.env.CREDENTIAL_ENC_KEY}`).digest();
const sign = (v: string) => crypto.createHmac('sha256', key()).update(v).digest('base64url');

export function makeSession(days = 7): string {
  const exp = String(Date.now() + days * 86_400_000);
  return `${exp}.${sign(exp)}`;
}

export function verifySession(value?: string): boolean {
  if (!value || !process.env.DASHBOARD_PASSWORD) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig) return false;
  const good = Buffer.from(sign(exp)), got = Buffer.from(sig);
  return good.length === got.length && crypto.timingSafeEqual(good, got) && Number(exp) > Date.now();
}

export function checkPassword(input: string): boolean {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return false;
  const h = (s: string) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(input), h(pw));
}
