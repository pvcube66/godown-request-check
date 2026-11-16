'use client';
import Link from 'next/link';

/** Shown instead of a broken page when something unexpected goes wrong on a screen. The menu around it stays usable. */
export default function ScreenError({ error, retry }: { error: unknown; retry: () => void }) {
  const ref = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: string }).digest ?? '') : '';
  return (
    <div className="empty" role="alert">
      <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="34" fill="var(--surface)" /><path d="M36 20v20M36 49v2" fill="none" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" /></svg>
      <h2>This page could not be shown</h2>
      <p>Something went wrong while loading it. Your data is safe. Please try again, and if it keeps happening tell an administrator.</p>
      {ref && <p className="mut small">Reference: {ref}</p>}
      <p>
        <button type="button" className="btn primary-ish" onClick={() => retry()}>Try again</button>{' '}
        <Link href="/" className="btn">Go to the home page</Link>
      </p>
    </div>
  );
}
