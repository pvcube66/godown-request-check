import { actorOf, getViewer, requireAccess } from './viewer';

/** Master data, godown logins and users are for administrators only (role from the signed-in person's own login). */
export async function masterAdminAccess(): Promise<{ authorized: boolean }> {
  const v = await getViewer();
  return { authorized: v?.role === 'admin' };
}
export async function requireMasterAdmin(): Promise<{ actor: string }> {
  return { actor: actorOf(await requireAccess('admin')) };
}
