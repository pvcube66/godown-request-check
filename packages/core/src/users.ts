import { randomUUID, scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Collection } from 'mongodb';
import type { DistrictDoc, AuditDoc } from './masterData.js';

/** People who sign in to the dashboard. admin = everything; operator = works on their districts; viewer = reads their districts. */
export const ROLES = ['admin', 'operator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export interface UserDoc {
  userId: string;
  name: string;
  phone: string;
  email: string;                    // lower case, unique
  role: Role;
  districts: string[];              // district codes (see `districts`); ignored for admins, who see everything
  passwordHash: string;
  status: 'active' | 'disabled';
  failedLogins: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date; updatedAt: Date;
}

export interface UserCollections {
  users: Collection<UserDoc>;
  districts: Collection<DistrictDoc>;
  auditLog: Collection<AuditDoc>;
}

export class UserInputError extends Error {}

export const MIN_PASSWORD = 10;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

// ----- passwords (scrypt, per-user random salt) -----
const KEYLEN = 64;
const scrypt = (pw: string, salt: Buffer) => new Promise<Buffer>((res, rej) => scryptCb(pw, salt, KEYLEN, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${(await scrypt(password, salt)).toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, saltB64, hashB64] = stored.split('$');
  if (kind !== 'scrypt' || !saltB64 || !hashB64 || password.length > 1024) return false;
  const want = Buffer.from(hashB64, 'base64url');
  const got = await scrypt(password, Buffer.from(saltB64, 'base64url'));
  return want.length === got.length && timingSafeEqual(want, got);
}

// ----- input checks -----
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalizeEmail = (v: string) => v.normalize('NFKC').trim().toLowerCase();

export interface UserInput { name: string; phone: string; email: string; role: string; districts: string[] }

export function validateUserInput(i: UserInput): { name: string; phone: string; email: string; role: Role; districts: string[] } {
  const name = i.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 100) throw new UserInputError('Enter the person’s name (2 to 100 letters).');
  const email = normalizeEmail(i.email);
  if (email.length > 200 || !EMAIL.test(email)) throw new UserInputError('Enter a valid email address.');
  const phone = i.phone.trim();
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) throw new UserInputError('Enter a phone number with digits only (7 to 20 digits).');
  if (!(ROLES as readonly string[]).includes(i.role)) throw new UserInputError('Choose a role: admin, operator or viewer.');
  const districts = [...new Set(i.districts.map((d) => d.trim()).filter(Boolean))];
  return { name, phone, email, role: i.role as Role, districts };
}

export function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD) throw new UserInputError(`The password must be at least ${MIN_PASSWORD} characters long.`);
  if (password.length > 200) throw new UserInputError('The password is too long.');
}

async function checkDistricts(c: UserCollections, role: Role, codes: string[]) {
  if (role === 'admin') return;
  if (codes.length === 0) throw new UserInputError('Choose at least one district for an operator or viewer. Admins see every district.');
  const found = await c.districts.countDocuments({ code: { $in: codes } });
  if (found !== codes.length) throw new UserInputError('One of the chosen districts does not exist. Refresh the page and try again.');
}

const audit = (c: UserCollections, actor: string, action: string, target: string, details?: unknown) =>
  c.auditLog.insertOne({ actor, action, target, at: new Date(), ...(details === undefined ? {} : { details }) });

// ----- user management (admin only; the caller checks the role) -----
export async function createUser(c: UserCollections, input: UserInput & { password: string }, actor: string): Promise<UserDoc> {
  const v = validateUserInput(input);
  validatePassword(input.password);
  await checkDistricts(c, v.role, v.districts);
  const now = new Date();
  const doc: UserDoc = { userId: randomUUID(), ...v, districts: v.role === 'admin' ? [] : v.districts, passwordHash: await hashPassword(input.password), status: 'active', failedLogins: 0, lockedUntil: null, lastLoginAt: null, createdAt: now, updatedAt: now };
  try { await c.users.insertOne(doc); }
  catch (e) { if ((e as { code?: number }).code === 11000) throw new UserInputError('Someone with this email already has a login.'); throw e; }
  await audit(c, actor, 'user.create', doc.userId, { email: doc.email, role: doc.role, districts: doc.districts });
  return doc;
}

export async function updateUser(c: UserCollections, userId: string, input: UserInput, actor: string): Promise<void> {
  const v = validateUserInput(input);
  await checkDistricts(c, v.role, v.districts);
  const before = await c.users.findOne({ userId });
  if (!before) throw new UserInputError('That user no longer exists.');
  if (before.role === 'admin' && v.role !== 'admin' && !(await otherActiveAdmin(c, userId))) throw new UserInputError('At least one other active admin must remain.');
  try {
    await c.users.updateOne({ userId }, { $set: { ...v, districts: v.role === 'admin' ? [] : v.districts, updatedAt: new Date() } });
  } catch (e) { if ((e as { code?: number }).code === 11000) throw new UserInputError('Someone with this email already has a login.'); throw e; }
  await audit(c, actor, 'user.update', userId, { before: { email: before.email, role: before.role, districts: before.districts }, after: { email: v.email, role: v.role, districts: v.districts } });
}

async function otherActiveAdmin(c: UserCollections, userId: string) {
  return (await c.users.countDocuments({ role: 'admin', status: 'active', userId: { $ne: userId } })) > 0;
}

export async function setUserStatus(c: UserCollections, userId: string, status: 'active' | 'disabled', actor: string): Promise<void> {
  const u = await c.users.findOne({ userId });
  if (!u) throw new UserInputError('That user no longer exists.');
  if (status === 'disabled' && u.role === 'admin' && !(await otherActiveAdmin(c, userId))) throw new UserInputError('At least one other active admin must remain.');
  await c.users.updateOne({ userId }, { $set: { status, failedLogins: 0, lockedUntil: null, updatedAt: new Date() } });
  await audit(c, actor, status === 'disabled' ? 'user.disable' : 'user.enable', userId, { email: u.email });
}

export async function resetPassword(c: UserCollections, userId: string, password: string, actor: string): Promise<void> {
  validatePassword(password);
  const r = await c.users.updateOne({ userId }, { $set: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null, updatedAt: new Date() } });
  if (r.matchedCount !== 1) throw new UserInputError('That user no longer exists.');
  await audit(c, actor, 'user.password-reset', userId);
}

// ----- signing in -----
export type LoginResult = { ok: true; user: UserDoc } | { ok: false; reason: 'bad' | 'locked' | 'disabled' };

const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

/** Same answer for "no such user" and "wrong password", and the same work done, so the screen does not reveal who has a login. */
export async function authenticate(c: UserCollections, emailInput: string, password: string, now = new Date()): Promise<LoginResult> {
  const email = normalizeEmail(emailInput);
  const user = email ? await c.users.findOne({ email }) : null;
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user) return { ok: false, reason: 'bad' };
  if (user.lockedUntil && user.lockedUntil > now) return { ok: false, reason: 'locked' };
  if (!ok) {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await c.users.updateOne({ userId: user.userId }, { $set: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null } });
    return { ok: false, reason: lock ? 'locked' : 'bad' };
  }
  if (user.status !== 'active') return { ok: false, reason: 'disabled' };
  await c.users.updateOne({ userId: user.userId }, { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: now } });
  return { ok: true, user };
}

// ----- district access -----
/** Who is looking: the break-glass admin and real admins see everything; others see only their district codes. */
export interface Viewer { id: string; name: string; role: Role; districtCodes: string[] | null }   // null = all districts

export const canEdit = (v: Pick<Viewer, 'role'>) => v.role === 'admin' || v.role === 'operator';
export const isAdmin = (v: Pick<Viewer, 'role'>) => v.role === 'admin';

/** District names for the codes, as the portal spells them in every collection. */
export async function districtNamesFor(c: Pick<UserCollections, 'districts'>, codes: string[]): Promise<string[]> {
  if (!codes.length) return [];
  return (await c.districts.find({ code: { $in: codes } }, { projection: { name: 1 } }).toArray()).map((d) => d.name);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Matches a district name the way the codes were made: case, spacing and surrounding blanks do not matter. */
export const districtRegex = (name: string) => new RegExp(`^\\s*${name.normalize('NFKC').trim().split(/\s+/).map(escapeRe).join('\\s+')}\\s*$`, 'i');

/** A Mongo filter on `districtName` for this viewer, or null when they may see everything. An empty list matches nothing. */
export function districtScope(names: string[] | null): { districtName: { $in: RegExp[] } } | null {
  return names === null ? null : { districtName: { $in: names.map(districtRegex) } };
}

/** Adds the viewer's district limit to any filter. The limit is part of the database query, not a screen filter. */
export function scoped<T extends Record<string, unknown>>(filter: T, names: string[] | null): T | { $and: [T, NonNullable<ReturnType<typeof districtScope>>] } {
  const s = districtScope(names);
  return s ? { $and: [filter, s] } : filter;
}
