'use client';
import { useActionState, useState } from 'react';
import { loginAction } from './actions';

export default function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="login-form">
      <label htmlFor="password">Password</label>
      <div className="pw">
        <input id="password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" autoFocus required />
        <button type="button" className="linkish" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
      </div>
      {state?.error && <p className="form-error" role="alert">{state.error}</p>}
      <button className="primary big" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}
