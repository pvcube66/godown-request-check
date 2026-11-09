'use client';
import { useActionState } from 'react';
import { addAccountAction } from '../actions';

export default function AddForm() {
  const [state, action, pending] = useActionState(addAccountAction, null);
  return (
    <form action={action} className="card">
      <strong>Add a godown login</strong>
      <label htmlFor="username">Portal username</label><input id="username" name="username" autoComplete="off" required />
      <label htmlFor="password">Portal password</label><input id="password" name="password" type="password" autoComplete="new-password" required />
      <button disabled={pending}>{pending ? 'Checking login and loading history… (can take ~20s)' : 'Add and load history'}</button>
      {state && <p className={state.ok ? 'ok' : 'bad'}>{state.message}</p>}
      <p className="mut">The login is verified first, its godown is found automatically, and the password is stored encrypted.</p>
    </form>
  );
}
