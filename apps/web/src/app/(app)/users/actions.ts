'use server';

import { revalidatePath } from 'next/cache';
import { createUser, resetPassword, setUserStatus, updateUser, UserInputError, type UserInput } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { requireMasterAdmin } from '@/lib/master-auth';
import { getViewer } from '@/lib/viewer';
import type { MasterActionState } from '../master/action-state';

const text = (f: FormData, k: string, max = 200) => {
  const v = f.get(k);
  if (v !== null && typeof v !== 'string') throw new UserInputError(`Invalid ${k}`);
  const s = (v ?? '').trim();
  if (s.length > max) throw new UserInputError(`${k} is too long`);
  return s;
};
const input = (f: FormData): UserInput => ({ name: text(f, 'name', 100), phone: text(f, 'phone', 20), email: text(f, 'email'), role: text(f, 'role', 20), districts: f.getAll('districts').filter((d): d is string => typeof d === 'string' && d.length < 100) });

async function run(task: (actor: string) => Promise<string>): Promise<MasterActionState> {
  try {
    const { actor } = await requireMasterAdmin();
    const success = await task(actor);
    revalidatePath('/users');
    return { success };
  } catch (e) {
    if (e instanceof UserInputError) return { error: e.message };
    return { error: 'Could not save this change. Check that you are still signed in as an administrator, then try again.' };
  }
}

export async function createUserAction(_s: MasterActionState, f: FormData): Promise<MasterActionState> {
  return run(async (actor) => {
    const c = await getDb();
    const u = await createUser(c, { ...input(f), password: text(f, 'password', 200) }, actor);
    return `Login created for ${u.name}. Share the email and password with them privately; they can sign in right away.`;
  });
}

export async function updateUserAction(_s: MasterActionState, f: FormData): Promise<MasterActionState> {
  return run(async (actor) => {
    await updateUser(await getDb(), text(f, 'userId', 64), input(f), actor);
    return 'Saved. The change applies the next time this person opens a page.';
  });
}

export async function statusAction(_s: MasterActionState, f: FormData): Promise<MasterActionState> {
  return run(async (actor) => {
    const userId = text(f, 'userId', 64);
    const status = text(f, 'status', 10);
    if (status !== 'active' && status !== 'disabled') throw new UserInputError('Bad status');
    if (status === 'disabled' && (await getViewer())?.id === userId) throw new UserInputError('You cannot turn off your own login.');
    await setUserStatus(await getDb(), userId, status, actor);
    return status === 'disabled' ? 'Login turned off. They lose access immediately.' : 'Login turned on.';
  });
}

export async function resetPasswordAction(_s: MasterActionState, f: FormData): Promise<MasterActionState> {
  return run(async (actor) => {
    await resetPassword(await getDb(), text(f, 'userId', 64), text(f, 'password', 200), actor);
    return 'Password changed. Share it privately; the old one no longer works.';
  });
}
