import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from './auth';
import { checkMasterPassword, makeMasterSession, masterAdminConfigured, MASTER_COOKIE, verifyMasterSession } from './master-session';

export async function masterAdminAccess(): Promise<{ configured: boolean; authorized: boolean }> {
  const jar = await cookies();
  const dashboard = jar.get(SESSION_COOKIE)?.value ?? '';
  return { configured: masterAdminConfigured(), authorized: verifySession(dashboard) && verifyMasterSession(jar.get(MASTER_COOKIE)?.value, dashboard) };
}
export async function requireMasterAdmin(): Promise<{ actor: string }> {
  if (!(await masterAdminAccess()).authorized) throw new Error('Unlock master admin access first');
  // Individual operator identities replace this temporary administrator in Phase 2.
  return { actor: 'master-admin' };
}
export async function unlockMasterAdmin(password: string): Promise<boolean> {
  const jar = await cookies();
  const dashboard = jar.get(SESSION_COOKIE)?.value ?? '';
  if (!verifySession(dashboard) || !checkMasterPassword(password)) return false;
  jar.set(MASTER_COOKIE, makeMasterSession(dashboard), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 3600 });
  return true;
}
export async function lockMasterAdmin(): Promise<void> {
  (await cookies()).delete(MASTER_COOKIE);
}
