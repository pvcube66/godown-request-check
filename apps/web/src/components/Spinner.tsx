import Loader from './Loader';

/** Small version of the site loader for buttons and short messages (same animation as the full-page loader). */
export default function Spinner({ size = 18, label }: { size?: number; label?: string }) {
  return (
    <span className="spin-bars" style={{ height: size, minWidth: size }} role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <Loader size="sm" label="" />
    </span>
  );
}
