/** Placeholder shown while a screen is loading. Looks like the real screen so nothing jumps when it arrives. */
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="sk sk-small" /><div className="sk sk-title" /><div className="sk sk-line" />
      <div className="sk sk-summary" />
      <div className="sk-tabs"><div className="sk sk-tab" /><div className="sk sk-tab" /><div className="sk sk-tab" /></div>
      <div className="sk sk-filters" />
      <div className="sk sk-card" /><div className="sk sk-card" />
    </div>
  );
}
