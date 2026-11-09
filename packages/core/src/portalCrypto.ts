// Reproduces the portal's browser-side encryption (AES-256-CBC, key = SHA-256(scode),
// random 16-byte IV prepended, base64). Verified against the live portal.
import crypto from 'node:crypto';

const key = (scode: string) => crypto.createHash('sha256').update(scode).digest();

/** Fresh per-call session code: SHA-256 hex of 32 random bytes (same as the portal's fC()). */
export const newScode = (): string =>
  crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');

export function portalEncrypt(plain: string, scode: string): string {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', key(scode), iv);
  return Buffer.concat([iv, c.update(plain, 'utf8'), c.final()]).toString('base64');
}

export function portalDecrypt(b64: string, scode: string): string {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-cbc', key(scode), raw.subarray(0, 16));
  return Buffer.concat([d.update(raw.subarray(16)), d.final()]).toString('utf8');
}
