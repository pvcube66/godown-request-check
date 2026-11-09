'use client';
import { useActionState } from 'react';
import { addAccountAction } from '../actions';
import Spinner from '@/components/Spinner';

export default function AddForm() {
  const [state, action, pending] = useActionState(addAccountAction, null);
  return (
    <form action={action} className="card">
      <h2>Add another godown</h2>
      <p className="mut">Enter the same login the godown uses on the government portal. We check it, find the godown and load its past requests.</p>
      <label htmlFor="username">Portal username</label>
      <input id="username" name="username" autoComplete="off" required />
      <label htmlFor="password">Portal password</label>
      <input id="password" name="password" type="password" autoComplete="new-password" required />
      <button className="primary" disabled={pending}>{pending ? <><Spinner />Checking the login and loading requests…</> : 'Add this godown'}</button>
      {pending && <p className="mut" role="status">This can take up to a minute while we load the godown's past requests. Please keep this page open.</p>}
      {state && <p className={state.ok ? 'ok-text' : 'bad-text'} role="status">{state.message}</p>}
      <p className="mut" style={{ marginTop: 12, fontSize: 15 }}>The password is stored in encrypted form.</p>
    </form>
  );
}
