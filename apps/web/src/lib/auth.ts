import crypto from 'node:crypto';

export const SESSION_COOKIE = 'anomaly_session';
/** The subject of the break-glass session: the one emergency admin who signs in with the dashboard password. */
export const BREAK_GLASS = 'break-glass';

const key = () => crypto.createHash('sha256').update(`${process.env.DASHBOARD_PASSWORD}|${process.env.CREDENTIAL_ENC_KEY}`).digest();
const sign = (v: string) => crypto.createHmac('sha256', key()).update(v).digest('base64url');

/** A session is `subject.expiry.signature`. The subject is a user id (no dots) or BREAK_GLASS. */
export function makeSession(subject: string, days = 7): string {
  if (!subject || subject.includes('.')) throw new Error('Bad session subject');
  const body = `${subject}.${Date.now() + days * 86_400_000}`;
  return `${body}.${sign(body)}`;
}

/** The signed-in subject, or null when the cookie is missing, forged or expired. Whether that person still has access is checked against the database on each request. */
export function sessionSubject(value?: string): string | null {
  if (!value || !process.env.DASHBOARD_PASSWORD) return null;
  const [subject, exp, sig, extra] = value.split('.');
  if (!subject || !exp || !sig || extra !== undefined) return null;
  const good = Buffer.from(sign(`${subject}.${exp}`)), got = Buffer.from(sig);
  return good.length === got.length && crypto.timingSafeEqual(good, got) && Number(exp) > Date.now() ? subject : null;
}

export const verifySession = (value?: string): boolean => sessionSubject(value) !== null;

/** Break-glass password check (the dashboard password). */
export function checkPassword(input: string): boolean {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return false;
  const h = (s: string) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(input), h(pw));
}
