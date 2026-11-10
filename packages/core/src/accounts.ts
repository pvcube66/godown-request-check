import { AccountDoc, Collections } from './db.js';
import { fetchGodownsForUser, portalLogin, PortalSession } from './portalClient.js';
import { openSecret, sealSecret } from './secretBox.js';

const REFRESH_MARGIN_MS = 5 * 60_000;

/** Add (or update) a portal login. Logs in once to verify it and discovers its godowns automatically. */
export async function addAccount(c: Collections, username: string, password: string) {
  const session = await portalLogin(username, password);           // throws if credentials are wrong
  const godowns = await fetchGodownsForUser(session.token, username);
  if (godowns.length === 0) throw new Error(`No godowns found for ${username}`);
  const now = new Date();
  await c.accounts.updateOne(
    { username },
    {
      $set: {
        passwordEnc: sealSecret(password), tokenEnc: sealSecret(session.token),
        tokenExpiresAt: session.expiresAt, godowns, status: 'active',
        lastLoginAt: now, lastError: null,
      },
      $setOnInsert: { username, createdAt: now },
    },
    { upsert: true },
  );
  await c.godowns.bulkWrite(godowns.map((gd) => ({ updateOne: {
    filter: { godownId: gd.id },
    update: {
      $set: { portalLogin: username, name: gd.name, updatedAt: now },
      $setOnInsert: { godownId: gd.id, status: 'active' as const, createdAt: now },
    },
    upsert: true,
  } })));
  return { username, godowns };
}

/** Returns a valid token, logging in again automatically when missing or about to expire. */
export async function getToken(c: Collections, acct: AccountDoc, force = false): Promise<string> {
  const valid = acct.tokenEnc && acct.tokenExpiresAt &&
    acct.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS;
  if (valid && !force) return openSecret(acct.tokenEnc!);
  const s: PortalSession = await portalLogin(acct.username, openSecret(acct.passwordEnc));
  acct.tokenEnc = sealSecret(s.token); acct.tokenExpiresAt = s.expiresAt;
  await c.accounts.updateOne({ username: acct.username }, {
    $set: { tokenEnc: acct.tokenEnc, tokenExpiresAt: s.expiresAt, lastLoginAt: new Date(), status: 'active', lastError: null },
  });
  return s.token;
}
