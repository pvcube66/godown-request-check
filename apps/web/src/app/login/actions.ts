'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkPassword, makeSession, SESSION_COOKIE } from '@/lib/auth';

export async function loginAction(_prev: unknown, formData: FormData): Promise<{ error: string } | null> {
  await new Promise((r) => setTimeout(r, 600));                       // slows down password guessing
  if (!checkPassword(String(formData.get('password') ?? ''))) {
    return { error: 'That password is not right. Please check it and try again.' };
  }
  (await cookies()).set(SESSION_COOKIE, makeSession(), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 86_400 });
  redirect('/');
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
