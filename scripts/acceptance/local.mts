import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDb } from '../../packages/core/src/index.ts';

/** Shared by the acceptance scripts. They only ever talk to a database on THIS computer. */
export const LOCAL_URI = process.env.ACCEPT_MONGODB_URI ?? 'mongodb://127.0.0.1:27118/?replicaSet=rs0';

/** Reads the two secrets the web app needs to sign sessions from the repo's .env (never printed). */
export function loadSecrets() {
  const env = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'), 'utf8');
  const get = (k: string) => env.split('\n').find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? '';
  const secrets = { DASHBOARD_PASSWORD: get('DASHBOARD_PASSWORD'), CREDENTIAL_ENC_KEY: get('CREDENTIAL_ENC_KEY') };
  if (!secrets.DASHBOARD_PASSWORD || !secrets.CREDENTIAL_ENC_KEY) throw new Error('DASHBOARD_PASSWORD and CREDENTIAL_ENC_KEY must be in .env');
  Object.assign(process.env, secrets);
  return secrets;
}

/** Refuses to run unless the database is local and the database name is clearly a test one. */
export function assertLocal(uri: string, dbName: string) {
  const host = new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error(`Refusing to run: ${host} is not this computer.`);
  if (!/^(it_|test_|accept)/.test(dbName)) throw new Error(`Refusing to run: database name "${dbName}" does not look like a test database (use it_...).`);
}

export async function connectLocal(dbName: string) {
  assertLocal(LOCAL_URI, dbName);
  loadSecrets();
  return connectDb(LOCAL_URI, dbName);
}
