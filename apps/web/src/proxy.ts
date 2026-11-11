import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

/** Everything except the login page needs a valid session cookie. (Two exceptions: the WhatsApp webhook, which checks Meta's signature instead, and the health check, which shows only times and counts.) The page itself then checks the database
 *  (is this person still active, which districts), so a valid signature alone never grants data. */
export function proxy(req: NextRequest) {
  if (!process.env.DASHBOARD_PASSWORD) return new NextResponse('Dashboard password is not configured.', { status: 503 });
  const ok = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const onLogin = req.nextUrl.pathname === '/login';
  const ended = req.nextUrl.searchParams.get('ended') === '1';      // access was withdrawn: show the sign-in page even with an old cookie
  if (ok && onLogin && !ended) return NextResponse.redirect(new URL('/', req.url));
  if (!ok && !onLogin) return NextResponse.redirect(new URL('/login', req.url));
  return NextResponse.next();
}
export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico|robots.txt|icon.svg|api/whatsapp/webhook|api/health|api/cron).*)' };
