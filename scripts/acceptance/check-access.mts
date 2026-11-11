import { closeDb } from '../../packages/core/src/index.ts';
import { makeSession, BREAK_GLASS } from '../../apps/web/src/lib/auth.ts';
import { connectLocal } from './local.mts';

/** Role and district-limit checks against a RUNNING copy of the web app that is using the seeded local test database.
 *  Usage: npx tsx scripts/acceptance/check-access.ts [baseUrl] [dbName]
 *  (see scripts/acceptance/README.md for how to start the app safely) */
const base = process.argv[2] ?? 'http://127.0.0.1:3199';
const dbName = process.argv[3] ?? 'it_accept';
const c = await connectLocal(dbName);
const users = Object.fromEntries((await c.users.find({}).toArray()).map((u) => [u.email.split('@')[0]!, u.userId]));
const cookie: Record<string, string> = { admin: makeSession(users.admin!), operator: makeSession(users.operator!), viewer: makeSession(users.viewer!), other: makeSession(users.other!), breakglass: makeSession(BREAK_GLASS) };
const issues = Object.fromEntries((await c.issues.find({}).toArray()).map((i) => [i.hostelCode, i.issueId]));
await closeDb();

const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
async function get(who: string | null, path: string) {
  const res = await fetch(base + path, { redirect: 'manual', headers: who ? { cookie: `anomaly_session=${cookie[who]}` } : {} });
  const body = await res.text();
  return { status: res.status, body, text: text(body), location: res.headers.get('location') ?? '' };
}
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`); if (!ok) failed++; };
const hasWar = (s: string) => /warangal/i.test(s);
const hasNal = (s: string) => /nalgonda/i.test(s);
const adminOnly = /administrators? only|for administrators|by administrators|only an administrator|only administrators/i;

console.log(`Checking ${base} (database ${dbName})\n`);

// ---- not signed in
for (const p of ['/', '/orders', '/orders/csv', '/dashboards', '/suppliers', '/search?q=a', '/exports/orders', '/whatsapp', '/users']) {
  const r = await get(null, p); check(`signed out: ${p} goes to the sign-in page`, r.status === 307 && r.location.includes('/login'), `${r.status} ${r.location}`);
}
const forged = await fetch(base + '/', { redirect: 'manual', headers: { cookie: 'anomaly_session=x.9999999999999.abc' } });
check('a forged cookie is not accepted', forged.status === 307);
const hook = await fetch(base + '/api/whatsapp/webhook', { method: 'POST', body: '{}' });
check('WhatsApp webhook: unsigned update is refused (and not sent to the sign-in page)', hook.status === 401, String(hook.status));
check('WhatsApp webhook: wrong setup token is refused', (await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`)).status === 403);
const health = await fetch(base + '/api/health'); const hj = await health.json() as { ok?: boolean };
check('health check answers without sign-in and says healthy after a recent good run', health.status === 200 && hj.ok === true, `${health.status}`);

// ---- who sees which district
const pages = ['/', '/orders', '/search?q=KGBV', '/report', '/dashboards?view=district', '/suppliers?by=district', '/suppliers?by=hostel', '/issues?tab=all'];
for (const p of pages) {
  const a = await get('admin', p), o = await get('operator', p), v = await get('viewer', p);
  check(`admin sees both districts: ${p}`, a.status === 200 && hasNal(a.text) && hasWar(a.text), `${a.status}`);
  check(`operator sees only own district: ${p}`, o.status === 200 && hasNal(o.text) && !hasWar(o.text), `${o.status} nal=${hasNal(o.text)} war=${hasWar(o.text)}`);
  check(`viewer sees only own district: ${p}`, v.status === 200 && !hasWar(v.text), `${v.status}`);
}
for (const [who, own, other] of [['operator', 'A1', 'B1'], ['other', 'B1', 'A1']] as const) {
  const mine = await get(who, `/hostel/${own}`), theirs = await get(who, `/hostel/${other}`);
  check(`${who}: own hostel page opens`, mine.status === 200 && !/Hostel not found/.test(mine.text));
  check(`${who}: another district's hostel page is "not found" and shows nothing`, /Hostel not found/.test(theirs.text) && !(other === 'B1' ? hasWar(theirs.text) : hasNal(theirs.text)));
  const mo = await get(who, `/orders/S-${own}-pending`), to = await get(who, `/orders/S-${other}-pending`);
  check(`${who}: own order opens`, mo.status === 200 && /Timeline/.test(mo.text));
  check(`${who}: another district's order is not found`, /could not be found|404/.test(to.body) && !/Timeline/.test(to.text));
  const mi = await get(who, `/issues/${issues[own]}`), ti = await get(who, `/issues/${issues[other]}`);
  check(`${who}: own issue opens`, mi.status === 200 && /Progress/.test(mi.text));
  check(`${who}: another district's issue is not found`, /could not be found|404/.test(ti.body) && !/Progress/.test(ti.text));
}

// ---- downloads
const aCsv = await get('admin', '/orders/csv'), oCsv = await get('operator', '/orders/csv');
check('orders download: operator gets fewer rows than admin and none from the other district', aCsv.body.split('\n').length > oCsv.body.split('\n').length && !hasWar(oCsv.body), `${aCsv.body.split('\n').length} vs ${oCsv.body.split('\n').length}`);
for (const p of ['/report/csv', '/dashboards/csv?view=district', '/suppliers/csv?by=district']) { const r = await get('operator', p); check(`operator download ${p} has no other-district rows`, r.status === 200 && !hasWar(r.body)); }
for (const k of ['orders', 'flags', 'issues', 'remarks']) {
  check(`full copy ${k}: admin can download`, (await get('admin', `/exports/${k}`)).status === 200);
  check(`full copy ${k}: operator and viewer cannot`, (await get('operator', `/exports/${k}`)).status === 403 && (await get('viewer', `/exports/${k}`)).status === 403);
}
check('full copy: unknown kind is not found', (await get('admin', '/exports/users')).status === 404);

// ---- admin-only screens, buttons, navigation
for (const p of ['/users', '/master', '/accounts', '/whatsapp', '/whatsapp/connect', '/whatsapp/templates', '/whatsapp/people', '/whatsapp/send', '/whatsapp/chats', '/exports', '/runs', '/accuracy']) {
  const a = await get('admin', p), o = await get('operator', p), v = await get('viewer', p);
  check(`${p}: admin can use it`, a.status === 200 && !adminOnly.test(a.text), `${a.status}`);
  check(`${p}: operator and viewer are told it is for administrators`, adminOnly.test(o.text) && adminOnly.test(v.text));
}
const nav = (r: { body: string }, href: string) => r.body.includes(`href="${href}"`);
const an = await get('admin', '/'), on = await get('operator', '/');
check('menu: admin sees Users, Connect WhatsApp, Full copy', ['/users', '/whatsapp/connect', '/whatsapp/templates', '/exports'].every((h) => nav(an, h)));
check('menu: operator does not', ['/users', '/whatsapp', '/whatsapp/connect', '/whatsapp/templates', '/whatsapp/people', '/exports', '/master'].every((h) => !nav(on, h)));
check('menu: everyone sees Dashboards, Supplier performance, Issues', ['/dashboards', '/suppliers', '/issues'].every((h) => nav(on, h)));
check('viewer has no "Issue" button, operator has', !(await get('viewer', '/')).text.includes('Issue (reject') && on.text.includes('Issue (reject'));
const vi = await get('viewer', `/issues/${issues.A1}`), oi = await get('operator', `/issues/${issues.A1}`);
check('viewer cannot add remarks or close an issue, operator can', !/Add remark|Close this issue/.test(vi.text) && /Add remark/.test(oi.text));
check('overdue issue shows on the issues page and as a bar on the first page', /overdue/.test((await get('operator', '/issues?tab=waiting')).text) && /not sent a new indent/.test(on.text));
check('break-glass admin sees both districts', hasWar((await get('breakglass', '/')).text));

// ---- the rules shown to people
const stuck = await get('admin', '/orders?stuck=7');
check('stuck list only shows orders still at an open stage', stuck.status === 200 && !/>Acknowledge<\/b>/.test(stuck.body.replace(/<th[\s\S]*?<\/th>/g, '')));
const ack = await get('admin', '/orders?stage=received');
check('acknowledged orders show a green date and no running days', /ack-date/.test(ack.body) && !/for \d+ days/.test(ack.text));
const dash = await get('admin', '/dashboards');
const tabs = Number((/All\s*<span[^>]*>(\d[\d,]*)</.exec((await get('admin', '/orders')).body) ?? [])[1]?.replace(/,/g, ''));
check('dashboard total equals the Order tracking "All" count', Number((/All orders\s*<\/b>?\s*<\/td>[\s\S]*?>(\d[\d,]*)</.exec(dash.body) ?? [])[1]?.replace(/,/g, '')) === tabs || new RegExp(`${tabs} orders`).test(dash.text), `tabs=${tabs}`);
check('supplier page lists the mapped suppliers', /Test Supplier One/.test((await get('admin', '/suppliers')).text));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
