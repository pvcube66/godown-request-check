'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Icon } from '@/components/Icons';
import Spinner from '@/components/Spinner';

/** Hostel search. Uses the same smooth navigation as the filters, so the loading bar and placeholder screen appear. */
export default function SearchBox({ base, q }: { base: Record<string, string>; q: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <form className="search" role="search" onSubmit={(e) => {
      e.preventDefault();
      const value = String(new FormData(e.currentTarget).get('q') ?? '').trim();
      const p = new URLSearchParams(base);
      p.delete('all'); p.delete('p'); if (value) p.set('q', value); else p.delete('q');
      window.dispatchEvent(new Event('nav-start'));
      start(() => router.push(`/?${p}`));
    }}>
      <label htmlFor="q">Find a hostel</label>
      <div className="search-row">
        <span className="search-box"><Icon name="search" size={18} /><input id="q" name="q" defaultValue={q} placeholder="Type part of the name" autoComplete="off" /></span>
        <button className="btn" disabled={pending}>{pending ? <><Spinner size={16} />Searching…</> : 'Search'}</button>
        {q && <Link href={`/?${new URLSearchParams(base)}`} className="link-arrow">Clear</Link>}
      </div>
    </form>
  );
}
