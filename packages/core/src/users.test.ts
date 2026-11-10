import { describe, expect, it } from 'vitest';
import { authenticate, createUser, districtRegex, districtScope, hashPassword, LOCK_MINUTES, MAX_FAILED_LOGINS, resetPassword, scoped, setUserStatus, updateUser, UserInputError, validatePassword, validateUserInput, verifyPassword, type UserCollections, type UserDoc } from './users.js';

/** A tiny in-memory stand-in for the three collections the user code touches. */
function fake(districts: string[] = ['D-1', 'D-2', 'D-3']) {
  const users: UserDoc[] = [];
  const audit: { actor: string; action: string; target: string }[] = [];
  const match = (u: UserDoc, f: Record<string, unknown>) => Object.entries(f).every(([k, v]) => {
    const x = (u as unknown as Record<string, unknown>)[k];
    if (v && typeof v === 'object' && '$ne' in (v as object)) return x !== (v as { $ne: unknown }).$ne;
    return x === v;
  });
  const c = {
    users: {
      findOne: async (f: Record<string, unknown>) => users.find((u) => match(u, f)) ?? null,
      insertOne: async (d: UserDoc) => {
        if (users.some((u) => u.email === d.email)) throw Object.assign(new Error('dup'), { code: 11000 });
        users.push({ ...d });
      },
      updateOne: async (f: Record<string, unknown>, upd: { $set: Partial<UserDoc> }) => {
        const u = users.find((x) => match(x, f));
        if (u) Object.assign(u, upd.$set);
        return { matchedCount: u ? 1 : 0 };
      },
      countDocuments: async (f: Record<string, unknown>) => users.filter((u) => match(u, f)).length,
    },
    districts: { countDocuments: async (f: { code: { $in: string[] } }) => f.code.$in.filter((x) => districts.includes(x)).length },
    auditLog: { insertOne: async (a: { actor: string; action: string; target: string }) => { audit.push(a); } },
  } as unknown as UserCollections;
  return { c, users, audit };
}
const person = { name: 'Vikas Rao', phone: '+91 98765 43210', email: 'Vikas@Example.com', role: 'operator', districts: ['D-1', 'D-2'] };

describe('passwords', () => {
  it('verifies the right password and rejects others', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
  it('uses a different salt every time', async () => {
    expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
  });
  it('rejects malformed stored hashes and absurd input without throwing', async () => {
    expect(await verifyPassword('x', 'plain-text')).toBe(false);
    expect(await verifyPassword('x'.repeat(5000), await hashPassword('abcdefghij'))).toBe(false);
  });
  it('enforces a minimum length', () => {
    expect(() => validatePassword('short')).toThrow(UserInputError);
    expect(() => validatePassword('long-enough-1')).not.toThrow();
  });
});

describe('input checks', () => {
  it('normalizes name and email', () => {
    expect(validateUserInput({ ...person, name: '  Vikas   Rao ' })).toMatchObject({ name: 'Vikas Rao', email: 'vikas@example.com' });
  });
  it.each([
    { name: 'V' }, { email: 'no-at-sign' }, { phone: 'abc' }, { role: 'owner' },
  ])('rejects bad input %j', (bad) => {
    expect(() => validateUserInput({ ...person, ...bad })).toThrow(UserInputError);
  });
});

describe('creating and changing users', () => {
  it('creates a user with a hashed password and writes an audit entry', async () => {
    const { c, users, audit } = fake();
    const u = await createUser(c, { ...person, password: 'a-long-password' }, 'admin@x');
    expect(users).toHaveLength(1);
    expect(u.passwordHash).not.toContain('a-long-password');
    expect(audit.map((a) => a.action)).toEqual(['user.create']);
  });
  it('refuses a second login with the same email, in any letter case', async () => {
    const { c } = fake();
    await createUser(c, { ...person, password: 'a-long-password' }, 'a');
    await expect(createUser(c, { ...person, email: 'VIKAS@example.COM', password: 'another-long-one' }, 'a')).rejects.toThrow(/already has a login/);
  });
  it('requires districts for operators and viewers, not for admins, and rejects unknown districts', async () => {
    const { c } = fake();
    await expect(createUser(c, { ...person, districts: [], password: 'a-long-password' }, 'a')).rejects.toThrow(/at least one district/);
    await expect(createUser(c, { ...person, districts: ['D-9'], password: 'a-long-password' }, 'a')).rejects.toThrow(/does not exist/);
    const admin = await createUser(c, { ...person, email: 'boss@x.com', role: 'admin', districts: ['D-1'], password: 'a-long-password' }, 'a');
    expect(admin.districts).toEqual([]);
  });
  it('keeps the last active admin from being demoted or disabled', async () => {
    const { c } = fake();
    const a = await createUser(c, { ...person, email: 'a@x.com', role: 'admin', districts: [], password: 'a-long-password' }, 'x');
    await expect(setUserStatus(c, a.userId, 'disabled', 'x')).rejects.toThrow(/other active admin/);
    await expect(updateUser(c, a.userId, { ...person, email: 'a@x.com', role: 'viewer' }, 'x')).rejects.toThrow(/other active admin/);
    const b = await createUser(c, { ...person, email: 'b@x.com', role: 'admin', districts: [], password: 'a-long-password' }, 'x');
    await expect(setUserStatus(c, a.userId, 'disabled', 'x')).resolves.toBeUndefined();
    expect(b.status).toBe('active');
  });
  it('resets a password and clears a lock', async () => {
    const { c, users } = fake();
    const u = await createUser(c, { ...person, password: 'a-long-password' }, 'x');
    users[0]!.lockedUntil = new Date(Date.now() + 60_000); users[0]!.failedLogins = 3;
    await resetPassword(c, u.userId, 'brand-new-password', 'x');
    expect(users[0]!.lockedUntil).toBeNull();
    expect((await authenticate(c, 'vikas@example.com', 'brand-new-password')).ok).toBe(true);
  });
});

describe('signing in', () => {
  it('signs in with the right email (any case) and password', async () => {
    const { c } = fake();
    await createUser(c, { ...person, password: 'a-long-password' }, 'x');
    const r = await authenticate(c, ' VIKAS@example.com ', 'a-long-password');
    expect(r.ok).toBe(true);
  });
  it('gives the same answer for an unknown email and a wrong password', async () => {
    const { c } = fake();
    await createUser(c, { ...person, password: 'a-long-password' }, 'x');
    expect(await authenticate(c, 'nobody@x.com', 'a-long-password')).toEqual({ ok: false, reason: 'bad' });
    expect(await authenticate(c, 'vikas@example.com', 'wrong-password')).toEqual({ ok: false, reason: 'bad' });
  });
  it(`locks for ${LOCK_MINUTES} minutes after ${MAX_FAILED_LOGINS} wrong passwords, even for the right one`, async () => {
    const { c } = fake();
    await createUser(c, { ...person, password: 'a-long-password' }, 'x');
    const t = new Date('2026-11-10T10:00:00Z');
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) expect(await authenticate(c, 'vikas@example.com', 'nope-nope-nope', t)).toEqual({ ok: false, reason: 'bad' });
    expect(await authenticate(c, 'vikas@example.com', 'nope-nope-nope', t)).toEqual({ ok: false, reason: 'locked' });
    expect(await authenticate(c, 'vikas@example.com', 'a-long-password', t)).toEqual({ ok: false, reason: 'locked' });
    const later = new Date(t.getTime() + (LOCK_MINUTES + 1) * 60_000);
    expect((await authenticate(c, 'vikas@example.com', 'a-long-password', later)).ok).toBe(true);
  });
  it('refuses a disabled user', async () => {
    const { c } = fake();
    const u = await createUser(c, { ...person, password: 'a-long-password' }, 'x');
    await createUser(c, { ...person, email: 'adm@x.com', role: 'admin', districts: [], password: 'a-long-password' }, 'x');
    await setUserStatus(c, u.userId, 'disabled', 'x');
    expect(await authenticate(c, 'vikas@example.com', 'a-long-password')).toEqual({ ok: false, reason: 'disabled' });
  });
});

describe('district scope', () => {
  it('matches a district name regardless of case and spacing, and nothing else', () => {
    const re = districtRegex('Jogulamba  Gadwal');
    expect(re.test('JOGULAMBA GADWAL')).toBe(true);
    expect(re.test('  jogulamba gadwal ')).toBe(true);
    expect(re.test('Jogulamba Gadwal Rural')).toBe(false);
    expect(districtRegex('A.B').test('AxB')).toBe(false);          // dots are literal
  });
  it('is no limit for admins, and "match nothing" for an empty list', () => {
    expect(districtScope(null)).toBeNull();
    expect(scoped({ a: 1 }, null)).toEqual({ a: 1 });
    expect(districtScope([])).toEqual({ districtName: { $in: [] } });
  });
  it('wraps the original filter so the limit cannot be overridden', () => {
    const f = scoped({ districtName: 'Other' }, ['Nalgonda']) as { $and: unknown[] };
    expect(f.$and).toHaveLength(2);
    expect(f.$and[0]).toEqual({ districtName: 'Other' });
  });
});
