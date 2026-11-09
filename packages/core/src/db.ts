import { Collection, Db, MongoClient } from 'mongodb';
import type { ParsedRequest } from './types.js';

export interface AccountDoc {
  username: string;                 // portal login id, e.g. GDN-JGL (unique)
  passwordEnc: string;              // AES-GCM sealed
  tokenEnc?: string | null;         // AES-GCM sealed current token
  tokenExpiresAt?: Date | null;
  godowns: { id: number; name: string }[];
  status: 'active' | 'needs_attention' | 'disabled';
  lastLoginAt?: Date | null;
  lastSyncAt?: Date | null;
  lastError?: string | null;
  createdAt: Date;
}

export type RequestDoc = ParsedRequest & { firstSeenAt: Date; updatedAt: Date };

export interface AnomalyDoc {
  key: string;                      // godownId|hostelCode|month|item (unique)
  godownId: number; hostelCode: string; hostelName: string; districtName: string;
  month: string; item: string;
  requested: number; expected: number; ratio: number; score: number;
  severity: 'low' | 'medium' | 'high';
  method: 'own-history' | 'peers' | 'blend';
  /** What similar hostels ask for this item (scaled to this hostel's size): the typical amount, the usual range, and how many hostels were compared. */
  peer?: { count: number; low: number; high: number; typical: number };
  /** 'typing' = the same number was entered for several items and is far above each item's usual. */
  kind: 'spike' | 'typing';
  slip?: { value: number; count: number; items: string[] };
  /** The jump is almost exactly 10x / 100x / 1000x, so an extra zero (or a shifted decimal point) was probably typed. */
  looksLikeExtraZero?: boolean;
  reason: string;
  status: 'open' | 'confirmed' | 'ignored' | 'expected' | 'resolved';
  detectedAt: Date; updatedAt: Date; lastSeenAt: Date;
}

export interface RunDoc {
  startedAt: Date; finishedAt?: Date; ok: boolean; trigger: string;
  accounts: { username: string; ok: boolean; rows?: number; error?: string }[];
  newAnomalies?: number;
}

export interface Collections {
  accounts: Collection<AccountDoc>;
  requests: Collection<RequestDoc>;
  anomalies: Collection<AnomalyDoc>;
  runs: Collection<RunDoc>;
  settings: Collection<{ _id: string; value: unknown }>;
}

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDb(uri = process.env.MONGODB_URI, name = process.env.MONGODB_DB ?? 'anomaly_detection') {
  if (!uri) throw new Error('MONGODB_URI is not set');
  if (!client) {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
    await client.connect();
    db = client.db(name);
  }
  const c = collections(db!);
  await ensureIndexes(c);
  return c;
}

export const collections = (d: Db): Collections => ({
  accounts: d.collection<AccountDoc>('accounts'),
  requests: d.collection<RequestDoc>('requests'),
  anomalies: d.collection<AnomalyDoc>('anomalies'),
  runs: d.collection<RunDoc>('runs'),
  settings: d.collection('settings'),
});

export async function ensureIndexes(c: Collections) {
  await c.accounts.createIndex({ username: 1 }, { unique: true });
  await c.requests.createIndex({ godownId: 1, requestId: 1 }, { unique: true });
  await c.requests.createIndex({ godownId: 1, month: 1, hostelCode: 1 });
  await c.anomalies.createIndex({ key: 1 }, { unique: true });
  await c.anomalies.createIndex({ status: 1, severity: 1, month: -1 });
  await c.runs.createIndex({ startedAt: -1 });
}

export async function closeDb() { await client?.close(); client = null; db = null; }
