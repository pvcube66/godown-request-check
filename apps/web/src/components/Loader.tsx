/** The one loading animation for the whole site: a circular spinner.
 *  `Loader` sits inline (buttons, panels); `PageLoader` fills the middle of the page while a screen is loading. */
export default function Loader({ label = 'Loading…', size = 'md' }: { label?: string; size?: 'sm' | 'md' | 'lg' }) {
  if (size === 'lg') {
    // the big loader: a glowing ring spinning around the app's three rising bars
    return (
      <span className="loader lg" role="status" aria-live="polite">
        <span className="loader-orbit" aria-hidden="true">
          <span className="loader-ring" />
          <span className="loader-mark"><i /><i /><i /></span>
        </span>
        {label && <span className="loader-label">{label}</span>}
      </span>
    );
  }
  return (
    <span className={`loader ${size}`} role="status" aria-live="polite">
      <span className="loader-ring" aria-hidden="true" />
      {label && <span className="loader-label">{label}</span>}
    </span>
  );
}

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return <div className="page-loader"><Loader size="lg" label={label} /></div>;
}
