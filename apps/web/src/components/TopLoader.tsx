'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Loader from './Loader';

/** Shows a progress bar and a "Loading…" message whenever you click a link, use the search box or change a filter,
 *  until the next screen has arrived. Also dims the page so it is obvious something is happening. */
export default function TopLoader() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [width, setWidth] = useState(0);
  const [running, setRunning] = useState(false);
  const [pill, setPill] = useState(false);
  const tick = useRef<ReturnType<typeof setInterval>>(undefined);
  const pillTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const safety = useRef<ReturnType<typeof setTimeout>>(undefined);

  const finish = () => {
    clearInterval(tick.current); clearTimeout(pillTimer.current); clearTimeout(safety.current);
    delete document.body.dataset.loading;
    setPill(false);
    setWidth((w) => (w > 0 ? 100 : 0));
    setTimeout(() => { setRunning(false); setWidth(0); }, 350);
  };
  const start = () => {
    clearInterval(tick.current); clearTimeout(pillTimer.current); clearTimeout(safety.current);
    document.body.dataset.loading = '1';
    setRunning(true); setWidth(10);
    tick.current = setInterval(() => setWidth((w) => (w < 88 ? w + (90 - w) * 0.12 : w)), 180);
    pillTimer.current = setTimeout(() => setPill(true), 200);        // only show the message if it takes a moment
    safety.current = setTimeout(finish, 20_000);                     // never get stuck
  };

  useEffect(() => { finish(); /* the new screen arrived */ }, [pathname, search]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || u.pathname.startsWith('/report/csv')) return;
      if (u.pathname === location.pathname && u.search === location.search) return;
      start();
    };
    const onSubmit = (e: Event) => {
      const f = e.target as HTMLFormElement;
      if (f.method?.toLowerCase() === 'get') start();
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('submit', onSubmit, true);
    window.addEventListener('nav-start', start);
    return () => { window.removeEventListener('click', onClick, true); window.removeEventListener('submit', onSubmit, true); window.removeEventListener('nav-start', start); };
  }, []);                                                                                  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className={`toploader ${running ? 'on' : ''}`} aria-hidden="true"><i style={{ width: `${width}%` }} /></div>
      {pill && <div className="busy" aria-hidden="false"><Loader size="lg" label="Loading…" /></div>}
    </>
  );
}
