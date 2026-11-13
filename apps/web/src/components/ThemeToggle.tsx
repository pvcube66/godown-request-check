'use client';

/** Light/dark switch. The page already has data-theme set (see the script in layout.tsx); this flips it and remembers the choice. */
type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> } };

export default function ThemeToggle() {
  const flip = (event: React.MouseEvent<HTMLButtonElement>) => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    const apply = () => {
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch { /* private mode: the choice just is not remembered */ }
    };
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) { apply(); return; }
    // the sun / moon icons spin as they swap
    root.classList.add('theme-switching');
    window.setTimeout(() => root.classList.remove('theme-switching'), 900);
    const doc = document as ViewTransitionDocument;
    if (!doc.startViewTransition) {
      // older browsers: fade the colours smoothly instead
      root.classList.add('theme-fade');
      apply();
      window.setTimeout(() => root.classList.remove('theme-fade'), 450);
      return;
    }
    // the new theme spreads out like a circle from the button
    const box = event.currentTarget.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = doc.startViewTransition(apply);
    transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(.22,.61,.36,1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => { /* the theme is already applied; only the animation was skipped */ });
  };
  return (
    <button type="button" className="theme-toggle" onClick={flip} aria-label="Switch between light and dark mode" title="Light / dark">
      <svg className="sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      <svg className="moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
    </button>
  );
}
