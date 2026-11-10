import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { districtNamesFor, type Collections, type Viewer } from '@anomaly/core';
import { BREAK_GLASS, SESSION_COOKIE, sessionSubject } from './auth';
import { getDb } from './db';

export type { Viewer };

/** Who is signed in right now, checked against the database every time so a disabled person loses access at once. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const subject = sessionSubject((await cookies()).get(SESSION_COOKIE)?.value);
  if (!subject) return null;
  if (subject === BREAK_GLASS) return { id: BREAK_GLASS, name: 'Emergency admin', role: 'admin', districtCodes: null };
  const u = await (await getDb()).users.findOne({ userId: subject });
  if (!u || u.status !== 'active') return null;
  return { id: u.userId, name: u.name, role: u.role, districtCodes: u.role === 'admin' ? null : u.districts };
});

/** For pages: sends people without access to the sign-in page. */
export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect('/login?ended=1');
  return v;
}

/** Name used in the change log. */
export const actorOf = (v: Viewer) => (v.id === BREAK_GLASS ? 'break-glass-admin' : `user:${v.id}`);

export class AccessError extends Error {
  constructor(readonly status: 401 | 403, message: string) { super(message); }
}

/** For actions and routes: throws instead of redirecting. `edit` also needs a role that may change things. */
export async function requireAccess(need: 'view' | 'edit' | 'admin' = 'view'): Promise<Viewer> {
  const v = await getViewer();
  if (!v) throw new AccessError(401, 'Please sign in again.');
  if (need === 'admin' && v.role !== 'admin') throw new AccessError(403, 'Only an administrator can do this.');
  if (need === 'edit' && v.role === 'viewer') throw new AccessError(403, 'Your login is read-only.');
  return v;
}

/** The district names this person may see (null = all). Every data query applies this. */
export async function visibleDistricts(c: Collections, v: Viewer): Promise<string[] | null> {
  return v.districtCodes === null ? null : districtNamesFor(c, v.districtCodes);
}

/** Convenience for pages: viewer plus their district names. */
export async function scopeFor(c: Collections): Promise<{ viewer: Viewer; names: string[] | null }> {
  const viewer = await requireViewer();
  return { viewer, names: await visibleDistricts(c, viewer) };
}
