import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined) }) }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
const findOne = vi.fn();
const districtsFind = vi.fn();
vi.mock('./db', () => ({ getDb: async () => ({ users: { findOne }, districts: { find: districtsFind } }) }));

import { BREAK_GLASS, makeSession, SESSION_COOKIE } from './auth';
import { AccessError, getViewer, requireAccess, requireViewer, visibleDistricts } from './viewer';

beforeEach(() => {
  vi.stubEnv('DASHBOARD_PASSWORD', 'synthetic-dashboard-password'); vi.stubEnv('CREDENTIAL_ENC_KEY', 'synthetic-key');
  jar.clear(); findOne.mockReset(); districtsFind.mockReset();
});
const signIn = (subject: string) => jar.set(SESSION_COOKIE, makeSession(subject));
const user = (over = {}) => ({ userId: 'u1', name: 'Vikas', role: 'operator', districts: ['D-1'], status: 'active', ...over });

describe('who is signed in', () => {
  it('nobody without a cookie, and no database lookup', async () => {
    expect(await getViewer()).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });
  it('the emergency admin sees every district', async () => {
    signIn(BREAK_GLASS);
    expect(await getViewer()).toMatchObject({ role: 'admin', districtCodes: null });
  });
  it('an operator gets only their own district codes', async () => {
    signIn('u1'); findOne.mockResolvedValue(user());
    expect(await getViewer()).toEqual({ id: 'u1', name: 'Vikas', role: 'operator', districtCodes: ['D-1'] });
  });
  it('an admin user sees every district whatever is stored on the record', async () => {
    signIn('u1'); findOne.mockResolvedValue(user({ role: 'admin', districts: ['D-1'] }));
    expect((await getViewer())!.districtCodes).toBeNull();
  });
  it('a valid cookie is not enough: a turned-off or deleted person loses access at once', async () => {
    signIn('u1'); findOne.mockResolvedValue(user({ status: 'disabled' }));
    expect(await getViewer()).toBeNull();
    findOne.mockResolvedValue(null);
    expect(await getViewer()).toBeNull();
  });
  it('pages send them to sign in; actions get an error', async () => {
    await expect(requireViewer()).rejects.toThrow('redirect:/login?ended=1');
    await expect(requireAccess('view')).rejects.toBeInstanceOf(AccessError);
  });
});

describe('what each role may do', () => {
  it('viewers can read but not edit; operators cannot do admin things; admins can do all', async () => {
    signIn('u1'); findOne.mockResolvedValue(user({ role: 'viewer' }));
    await expect(requireAccess('view')).resolves.toBeTruthy();
    await expect(requireAccess('edit')).rejects.toMatchObject({ status: 403 });
    findOne.mockResolvedValue(user());
    await expect(requireAccess('edit')).resolves.toBeTruthy();
    await expect(requireAccess('admin')).rejects.toMatchObject({ status: 403 });
    findOne.mockResolvedValue(user({ role: 'admin' }));
    await expect(requireAccess('admin')).resolves.toBeTruthy();
  });
});

describe('district names', () => {
  const c = { districts: { find: districtsFind }, users: { findOne } } as never;
  it('null for people who see everything, names for the rest', async () => {
    expect(await visibleDistricts(c, { id: 'a', name: 'A', role: 'admin', districtCodes: null })).toBeNull();
    districtsFind.mockReturnValue({ toArray: async () => [{ name: 'Nalgonda' }] });
    expect(await visibleDistricts(c, { id: 'u', name: 'U', role: 'operator', districtCodes: ['D-1'] })).toEqual(['Nalgonda']);
  });
  it('an operator with no districts gets an empty list (sees nothing), never null', async () => {
    expect(await visibleDistricts(c, { id: 'u', name: 'U', role: 'operator', districtCodes: [] })).toEqual([]);
  });
});
