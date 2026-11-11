/** The one loading animation for the whole site: three bars rising and falling, like the logo.
 *  `Loader` sits inline (buttons, panels); `PageLoader` fills the middle of the page while a screen is loading. */
export default function Loader({ label = 'Loading…', size = 'md' }: { label?: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`loader ${size}`} role="status" aria-live="polite">
      <span className="loader-bars" aria-hidden="true"><i /><i /><i /></span>
      {label && <span className="loader-label">{label}</span>}
    </span>
  );
}

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return <div className="page-loader"><Loader size="lg" label={label} /></div>;
}
