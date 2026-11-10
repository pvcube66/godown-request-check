'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticate, normalizeEmail } from '@anomaly/core';
import { BREAK_GLASS, checkPassword, makeSession, SESSION_COOKIE } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getViewer } from '@/lib/viewer';

const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 7 * 86_400, secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_INSECURE !== '1' };
const WRONG = 'That email or password is not right. Please check them and try again.';

export async function loginAction(_prev: unknown, formData: FormData): Promise<{ error: string } | null> {
  await new Promise((r) => setTimeout(r, 600));                       // slows down password guessing
  const email = normalizeEmail(String(formData.get('email') ?? ''));
  const password = String(formData.get('password') ?? '');
  const c = await getDb();
  const log = (action: string, target: string, details?: unknown) => c.auditLog.insertOne({ actor: target, action, target, at: new Date(), ...(details === undefined ? {} : { details }) }).catch(() => undefined);

  // The emergency admin signs in with the word "admin" and the dashboard password.
  if (email === 'admin') {
    if (!checkPassword(password)) { await log('login.failed', 'break-glass-admin'); return { error: WRONG }; }
    await log('login', 'break-glass-admin');
    (await cookies()).set(SESSION_COOKIE, makeSession(BREAK_GLASS), cookieOptions);
    redirect('/');
  }
  const r = await authenticate(c, email, password);
  if (!r.ok) {
    await log('login.failed', email.slice(0, 200) || 'unknown', { reason: r.reason });
    if (r.reason === 'locked') return { error: 'Too many wrong attempts. This login is locked for 15 minutes. An administrator can unlock it sooner.' };
    if (r.reason === 'disabled') return { error: 'This login has been turned off. Please ask an administrator.' };
    return { error: WRONG };
  }
  await log('login', `user:${r.user.userId}`, { email: r.user.email });
  (await cookies()).set(SESSION_COOKIE, makeSession(r.user.userId), cookieOptions);
  redirect('/');
}

export async function logoutAction() {
  const v = await getViewer();
  if (v) await (await getDb()).auditLog.insertOne({ actor: v.id === BREAK_GLASS ? 'break-glass-admin' : `user:${v.id}`, action: 'logout', target: v.id, at: new Date() }).catch(() => undefined);
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
