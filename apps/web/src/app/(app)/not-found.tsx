import Link from 'next/link';

/** Shown when an order, hostel, issue or other record does not exist (or is outside the districts the person may see). */
export default function NotFound() {
  return (
    <div className="empty">
      <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="34" fill="var(--surface)" /><path d="M26 26l20 20M46 26L26 46" fill="none" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" /></svg>
      <h2>Nothing found here</h2>
      <p>This record does not exist, or it is not in the districts you can see.</p>
      <p><Link href="/" className="btn primary-ish">Go to the home page</Link></p>
    </div>
  );
}
