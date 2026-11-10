'use client';
import { useActionState, useState } from 'react';
import { loginAction } from './actions';
import Spinner from '@/components/Spinner';

export default function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="login-form">
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="text" inputMode="email" autoComplete="username" autoFocus required maxLength={200} />
      <label htmlFor="password">Password</label>
      <div className="pw">
        <input id="password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required />
        <button type="button" className="linkish" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
      </div>
      {state?.error && <p className="form-error" role="alert">{state.error}</p>}
      <button className="primary big" disabled={pending}>{pending ? <><Spinner />Signing in…</> : 'Sign in'}</button>
    </form>
  );
}
