import { timingSafeEqual } from 'node:crypto';

/** True only when the request carries `Authorization: Bearer <CRON_SECRET>` exactly. Closed when no (or a too short) secret is set. */
export function authorised(header: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const got = Buffer.from(header), want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
