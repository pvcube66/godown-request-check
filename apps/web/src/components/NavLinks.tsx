'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [['/', 'Unusual requests'], ['/accounts', 'Godowns'], ['/runs', 'Past checks'], ['/accuracy', 'Accuracy']] as const;

export default function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main">
      {LINKS.map(([href, label]) => {
        const on = href === '/' ? path === '/' || path.startsWith('/hostel') || path.startsWith('/report') : path.startsWith(href);
        return <Link key={href} href={href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>{label}</Link>;
      })}
    </nav>
  );
}
