import { Collection, Db, MongoClient } from 'mongodb';
import type { ParsedRequest } from './types.js';
import type { OrderDoc } from './orders.js';
import type { MasterDataCollections } from './masterData.js';
import type { ItemMasterDoc } from './itemMaster.js';
import type { UserDoc } from './users.js';
import type { IssueDoc, RemarkDoc } from './issues.js';
import type { WhatsAppMessageDoc } from './whatsapp.js';

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

/** cancelReason: the reason written by the person who cancelled (rejected) the request, when there is one. */
export type RequestDoc = ParsedRequest & { firstSeenAt: Date; updatedAt: Date; cancelReason?: string | null };

export interface AnomalyDoc {
  key: string;                      // godownId|hostelCode|month|item (unique)
  godownId: number; hostelCode: string; hostelName: string; districtName: string;
  month: string; item: string;
  requested: number; expected: number; ratio: number; score: number;
  severity: 'low' | 'medium' | 'high';
  method: 'own-history' | 'peers' | 'blend';
  /** What similar hostels ask for this item (scaled to this hostel's size): the typical amount, the usual range, and how many hostels were compared. */
  peer?: {
    count: number; low: number; high: number; typical: number;
    /** 'students' = compared per student with hostels of a similar size (real student counts).
     *  'estimated' = the student count was not available, so size was guessed from the order itself. */
    basis: 'students' | 'estimated';
    sizeRange?: [number, number];   // student counts of the hostels compared with (when basis = 'students')
  };
  /** Number of students in this hostel, from the portal (absent when unknown). */
  students?: number;
  /** 'typing' = the same number was entered for several items and is far above each item's usual. */
  kind: 'spike' | 'typing' | 'order' | 'duplicate';
  /** kind 'duplicate': two requests from the same hostel and month that are almost identical. */
  dup?: { requestIds: [string, string]; dates: [string, string]; similarity: number; items: number; total: number };
  /** kind 'order': the whole order is out of proportion to the number of students (ratio = typical item ratio). */
  order?: { itemsCompared: number; /** the same whole-order measure for every month on record (1 = normal for the hostel's size) */ history?: { month: string; ratio: number }[] };
  /** True for item flags that belong to a whole-order finding for the same hostel and month (shown under it, not separately). */
  partOfOrder?: boolean;
  slip?: { value: number; count: number; items: string[] };
  /** The jump is almost exactly 10x / 100x / 1000x, so an extra zero (or a shifted decimal point) was probably typed. */
  looksLikeExtraZero?: boolean;
  /** When dividing by 10 / 100 / 1000 gives a normal amount, this is that amount (so the screen can say "a zero may have been typed"). */
  zeroFix?: { divisor: number; value: number };
  reason: string;
  status: 'open' | 'confirmed' | 'ignored' | 'expected' | 'resolved';
  detectedAt: Date; updatedAt: Date; lastSeenAt: Date;
}

export interface HostelDoc {
  godownId: number; hostelCode: string;
  students: number | null;          // total students enrolled (sum over classes), null when the portal has none
  checkedAt: Date;
}

export interface RunDoc {
  startedAt: Date; finishedAt?: Date; ok: boolean; trigger: string;
  accounts: { username: string; ok: boolean; rows?: number; error?: string }[];
  newAnomalies?: number;
}

export interface Collections extends MasterDataCollections {
  itemsMaster: Collection<ItemMasterDoc>;
  users: Collection<UserDoc>;
  issues: Collection<IssueDoc>;
  remarks: Collection<RemarkDoc>;
  whatsappMessages: Collection<WhatsAppMessageDoc>;
  accounts: Collection<AccountDoc>;
  requests: Collection<RequestDoc>;
  orders: Collection<OrderDoc>;
  anomalies: Collection<AnomalyDoc>;
  runs: Collection<RunDoc>;
  hostels: Collection<HostelDoc>;
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
  orders: d.collection<OrderDoc>('orders'),
  anomalies: d.collection<AnomalyDoc>('anomalies'),
  runs: d.collection<RunDoc>('runs'),
  hostels: d.collection<HostelDoc>('hostels'),
  settings: d.collection('settings'),
  districts: d.collection('districts'),
  godowns: d.collection('godowns'),
  suppliers: d.collection('suppliers'),
  mappings: d.collection('mappings'),
  hostelsMaster: d.collection('hostelsMaster'),
  itemsMaster: d.collection('itemsMaster'),
  users: d.collection('users'),
  issues: d.collection('issues'),
  remarks: d.collection('remarks'),
  whatsappMessages: d.collection('whatsappMessages'),
  auditLog: d.collection('auditLog'),
  async transaction<T>(fn: Parameters<MasterDataCollections['transaction']>[0]): Promise<T> {
    const session = d.client.startSession();
    try {
      return await session.withTransaction(() => fn(session), {
        readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 15000,
      }) as T;
    } finally { await session.endSession(); }
  },
});

export async function ensureIndexes(c: Collections) {
  await c.accounts.createIndex({ username: 1 }, { unique: true });
  await c.requests.createIndex({ godownId: 1, requestId: 1 }, { unique: true });
  await c.requests.createIndex({ godownId: 1, month: 1, hostelCode: 1 });
  await c.orders.createIndex({ account: 1, requestId: 1 }, { unique: true });
  await c.orders.createIndex({ stage: 1, stageSince: 1 });
  await c.anomalies.createIndex({ key: 1 }, { unique: true });
  await c.anomalies.createIndex({ status: 1, severity: 1, month: -1 });
  await c.anomalies.createIndex({ status: 1, severity: 1, ratio: -1 });      // the main list: open flags by seriousness, biggest first
  await c.runs.createIndex({ startedAt: -1 });
  await c.hostels.createIndex({ godownId: 1, hostelCode: 1 }, { unique: true });
  await c.districts.createIndex({ code: 1 }, { unique: true });
  await c.godowns.createIndex({ godownId: 1 }, { unique: true });
  await c.suppliers.createIndex({ code: 1 }, { unique: true });
  await c.mappings.createIndex({ districtCode: 1, from: 1 }, { unique: true });
  await c.mappings.createIndex({ godownId: 1, from: 1 });
  await c.hostelsMaster.createIndex({ godownId: 1, hostelCode: 1 }, { unique: true });
  await c.itemsMaster.createIndex({ key: 1 }, { unique: true });
  await c.auditLog.createIndex({ at: -1 });
  await c.users.createIndex({ email: 1 }, { unique: true });
  await c.users.createIndex({ userId: 1 }, { unique: true });
  await c.issues.createIndex({ issueId: 1 }, { unique: true });
  await c.issues.createIndex({ state: 1, raisedAt: -1 });
  await c.issues.createIndex({ godownId: 1, hostelCode: 1, month: 1 });
  await c.issues.createIndex({ anomalyKeys: 1 });
  await c.remarks.createIndex({ targetType: 1, targetId: 1, at: 1 });
  await c.whatsappMessages.createIndex({ messageId: 1 }, { unique: true, partialFilterExpression: { messageId: { $type: 'string' } } });
  await c.whatsappMessages.createIndex({ sendKey: 1 }, { unique: true, partialFilterExpression: { sendKey: { $type: 'string' } } });
  await c.whatsappMessages.createIndex({ requestId: 1, createdAt: 1 });
  await c.whatsappMessages.createIndex({ hostelCode: 1, createdAt: -1 });
}

export async function closeDb() { await client?.close(); client = null; db = null; }
