/** Small spinning ring for buttons and loading messages. */
export default function Spinner({ size = 18, label }: { size?: number; label?: string }) {
  return <span className="spin" style={{ width: size, height: size }} role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
