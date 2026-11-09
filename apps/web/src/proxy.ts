import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

/** Everything except the login page needs a valid session cookie. */
export function proxy(req: NextRequest) {
  if (!process.env.DASHBOARD_PASSWORD) return new NextResponse('Dashboard password is not configured.', { status: 503 });
  const ok = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const onLogin = req.nextUrl.pathname === '/login';
  if (ok && onLogin) return NextResponse.redirect(new URL('/', req.url));
  if (!ok && !onLogin) return NextResponse.redirect(new URL('/login', req.url));
  return NextResponse.next();
}
export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico|robots.txt|icon.svg).*)' };
