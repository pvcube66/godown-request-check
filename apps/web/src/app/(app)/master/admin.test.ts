import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('./ActionForm', () => ({ default: ({ submitLabel, children }: { submitLabel?: string; children?: unknown }) => createElement('form', null, submitLabel, children as never) }));
vi.mock('./ImportForm', () => ({ default: () => createElement('form') }));
vi.mock('next/link', () => ({ default: ({ href, className, children, ...rest }: { href: string; className?: string; children?: unknown }) => createElement('a', { href, className, ...rest }, children as never) }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSession } from 'mongodb';

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/master-auth', () => ({ masterAdminAccess: vi.fn(), requireMasterAdmin: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./import-file', () => ({ parseMappingUpload: vi.fn(), MAX_MAPPING_FILE_BYTES: 2 * 1024 * 1024 }));
vi.mock('@anomaly/core', async () => ({
  ...await import('../../../../../../packages/core/src/masterData.js'),
  ...await import('../../../../../../packages/core/src/mappingImport.js'),
  ...await import('../../../../../../packages/core/src/itemMaster.js'),
  seedMasterData: vi.fn(), importMappings: vi.fn(), reassignDistrict: vi.fn(), updateItemMaster: vi.fn(),
}));

import { getDb } from '@/lib/db';
import { masterAdminAccess, requireMasterAdmin } from '@/lib/master-auth';
import { revalidatePath } from 'next/cache';
import { importMappings, reassignDistrict, seedMasterData, updateItemMaster } from '@anomaly/core';
import { bootstrapAction, godownContactAction, hostelContactAction, importAction, itemCorrectionAction, reassignAction } from './actions';
import MasterPage from './page';
import { parseMappingUpload } from './import-file';
import { POST } from './import/route';
import { godownIdField, phoneField, textField } from './validation';

const form = (values: Record<string, string>) => {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
};
const at = new Date('2026-01-01T00:00:00Z');
const actor = 'synthetic-admin';
type Doc = Record<string, unknown>;
function database() {
  const state: Record<string, Doc[]> = {
    godowns: [{ godownId: 1, name: 'Synthetic Godown', contactPerson: 'Synthetic Contact', contactPhone: '1234567890', updatedAt: at }],
    hostelsMaster: [{ godownId: 1, hostelCode: 'H1', hostelName: 'Synthetic Hostel', districtCode: 'D1', hostelPhone: '1234567890', updatedAt: at }], auditLog: [],
  };
  const session = {} as ClientSession;
  const tables = Object.fromEntries(Object.keys(state).map((name) => [name, {
    findOne: vi.fn(async (filter: Doc, options: { session?: ClientSession }) => {
      expect(options.session).toBe(session);
      return structuredClone(state[name]!.find((d) => Object.entries(filter).every(([key, v]) => d[key] === v)) ?? null);
    }),
    updateOne: vi.fn(async (filter: Doc, update: { $set?: Doc; $unset?: Doc }, options: { session?: ClientSession }) => {
      expect(options.session).toBe(session);
      const doc = state[name]!.find((d) => Object.entries(filter).every(([key, v]) => d[key] === v));
      if (doc) {
        Object.assign(doc, update.$set);
        for (const key of Object.keys(update.$unset ?? {})) delete doc[key];
      }
      return { matchedCount: doc ? 1 : 0 };
    }),
    insertOne: vi.fn(async (doc: Doc, options: { session?: ClientSession }) => {
      expect(options.session).toBe(session);
      state[name]!.push(structuredClone(doc));
    }),
  }]));
  const transaction = vi.fn(async <T>(fn: (s: ClientSession) => Promise<T>): Promise<T> => {
    const before = structuredClone(state);
    try { return await fn(session); } catch (error) { Object.assign(state, before); throw error; }
  });
  const c = { ...tables, transaction } as unknown as Awaited<ReturnType<typeof getDb>>;
  vi.mocked(getDb).mockResolvedValue(c);
  return { state, c, transaction };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(masterAdminAccess).mockResolvedValue({ authorized: true });
  vi.mocked(requireMasterAdmin).mockResolvedValue({ actor });
});

describe('master access isolation', () => {
  it('never reads the DB or catalog for someone who is not an administrator', async () => {
    vi.mocked(masterAdminAccess).mockResolvedValue({ authorized: false });
    const page = await MasterPage({ searchParams: Promise.resolve({}) });
    expect(getDb).not.toHaveBeenCalled();
    expect(JSON.stringify(page)).toContain('Administrators only');
    expect(JSON.stringify(page)).not.toContain('Synthetic Godown');
  });
  it('loads only master catalogs when unlocked, with escaped search filters and missing-data guidance', async () => {
    const catalog = () => {
      const cursor = { sort: vi.fn(), skip: vi.fn(), limit: vi.fn(), toArray: vi.fn(async () => []) };
      cursor.sort.mockReturnValue(cursor); cursor.skip.mockReturnValue(cursor); cursor.limit.mockReturnValue(cursor);
      return { find: vi.fn(() => cursor), countDocuments: vi.fn(async () => 0) };
    };
    const tables = { districts: catalog(), godowns: catalog(), suppliers: catalog(), mappings: catalog(), auditLog: catalog(), itemsMaster: catalog(), hostelsMaster: catalog() };
    vi.mocked(getDb).mockResolvedValue(tables as unknown as Awaited<ReturnType<typeof getDb>>);
    const page = await MasterPage({ searchParams: Promise.resolve({ items: '.*', hostels: 'H(1)', ip: '999999' }) });
    expect(getDb).toHaveBeenCalledOnce();
    for (const table of Object.values(tables)) expect(table.find).toHaveBeenCalledOnce();
    expect(tables.itemsMaster.find).toHaveBeenCalledWith({ name: { $regex: '\\.\\*', $options: 'i' } });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('Bootstrap stored data');
    expect(html).toContain('No mapping history yet');
    const changes = renderToStaticMarkup(await MasterPage({ searchParams: Promise.resolve({ tab: 'changes' }) }));
    expect(changes).toContain('No changes have been recorded yet');
    expect(changes).not.toContain('No mapping history yet');
  });
  it.each([bootstrapAction, importAction, reassignAction, itemCorrectionAction, godownContactAction, hostelContactAction])('guards every privileged action before DB access: %s', async (action) => {
    vi.mocked(requireMasterAdmin).mockRejectedValue(new Error('locked'));
    expect(await action({}, new FormData())).toHaveProperty('error');
    expect(requireMasterAdmin).toHaveBeenCalledOnce();
    expect(getDb).not.toHaveBeenCalled();
    expect(seedMasterData).not.toHaveBeenCalled();
    expect(importMappings).not.toHaveBeenCalled();
    expect(reassignDistrict).not.toHaveBeenCalled();
    expect(updateItemMaster).not.toHaveBeenCalled();
  });
});

describe('contact validation and transactional writes', () => {
  it('validates phone length/digits, contact name length and numeric IDs', () => {
    for (const value of ['123', '+911234567890', '12345 7890', 'abcdefghij']) expect(() => phoneField(form({ hostelPhone: value }), 'hostelPhone')).toThrow();
    expect(phoneField(form({ hostelPhone: '' }), 'hostelPhone')).toBe('');
    expect(phoneField(form({ hostelPhone: '0123456789' }), 'hostelPhone')).toBe('0123456789');
    expect(() => textField(form({ contactPerson: 'a'.repeat(101) }), 'contactPerson', 100)).toThrow('100');
    for (const godownId of ['0', '-1', '1.5', '1e2', 'NaN']) expect(() => godownIdField(form({ godownId }))).toThrow();
  });
  it('stores only allowed godown contacts and audits actor and before/after in the transaction', async () => {
    const db = database();
    expect(await godownContactAction({}, form({ godownId: '1', contactPerson: 'New synthetic contact', contactPhone: '0123456789', status: 'disabled', portalLogin: 'must-not-change' }))).toHaveProperty('success');
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.state.godowns![0]).toMatchObject({ godownId: 1, contactPerson: 'New synthetic contact', contactPhone: '0123456789', name: 'Synthetic Godown' });
    expect(db.state.godowns![0]).not.toHaveProperty('status');
    expect(db.state.auditLog![0]).toMatchObject({ actor, action: 'contact.godown.update', target: 'godown:1', details: { before: { contactPhone: '1234567890' }, after: { contactPhone: '0123456789' } } });
    expect(revalidatePath).toHaveBeenCalledWith('/hostel/[code]', 'page');
  });
  it('empty contacts remove optional fields rather than storing empty strings', async () => {
    const db = database();
    expect(await godownContactAction({}, form({ godownId: '1', contactPerson: '', contactPhone: '' }))).toHaveProperty('success');
    expect(db.state.godowns![0]).not.toHaveProperty('contactPerson');
    expect(db.state.godowns![0]).not.toHaveProperty('contactPhone');
    expect(await hostelContactAction({}, form({ godownId: '1', hostelCode: 'H1', hostelPhone: '' }))).toHaveProperty('success');
    expect(db.state.hostelsMaster![0]).not.toHaveProperty('hostelPhone');
    expect(db.state.hostelsMaster![0]).toMatchObject({ godownId: 1, districtCode: 'D1' });
  });
  it('keeps unchanged contacts read-only', async () => {
    const db = database();
    expect(await godownContactAction({}, form({ godownId: '1', contactPerson: 'Synthetic Contact', contactPhone: '1234567890' }))).toEqual({ success: 'Godown contact is unchanged.' });
    expect(db.c.godowns.updateOne).not.toHaveBeenCalled();
    expect(db.state.auditLog).toEqual([]);
  });
  it('rolls back a contact change when its audit write fails', async () => {
    const db = database();
    const before = structuredClone(db.state);
    vi.mocked(db.c.auditLog.insertOne).mockRejectedValueOnce(new Error('synthetic audit failure'));
    expect(await hostelContactAction({}, form({ godownId: '1', hostelCode: 'H1', hostelPhone: '0123456789' }))).toHaveProperty('error');
    expect(db.state).toEqual(before);
  });
  it('returns validation errors and rejects unknown contacts without any mutation', async () => {
    const db = database();
    const before = structuredClone(db.state);
    expect(await godownContactAction({}, form({ godownId: '1', contactPhone: '123', contactPerson: '' }))).toEqual({ error: expect.stringContaining('10 digits') });
    expect(await hostelContactAction({}, form({ godownId: '1', hostelCode: 'missing', hostelPhone: '' }))).toEqual({ error: expect.stringContaining('Hostel not found') });
    expect(db.state).toEqual(before);
  });
});

describe('core action delegation', () => {
  it('bootstraps only through the stored-data helper using the guarded actor', async () => {
    const db = database();
    vi.mocked(seedMasterData).mockResolvedValue({ godowns: 2, hostels: 3, districts: 1 });
    expect(await bootstrapAction({}, new FormData())).toEqual({ success: expect.stringContaining('2 godowns, 3 hostels, 1 districts') });
    expect(seedMasterData).toHaveBeenCalledWith(db.c, actor);
  });
  it('uses the upload parser and displays inserted, closed and skipped totals', async () => {
    const db = database();
    vi.mocked(parseMappingUpload).mockResolvedValue([]);
    vi.mocked(importMappings).mockResolvedValue({ inserted: 2, closed: 1, skipped: 3, districtsCreated: 0, suppliersCreated: 0 });
    const data = new FormData(); data.set('mappingFile', new File(['synthetic'], 'mapping.csv'));
    expect(await importAction({}, data)).toEqual({ success: 'Mapping import complete: 2 inserted, 1 closed, 3 skipped.' });
    expect(importMappings).toHaveBeenCalledWith(db.c, [], actor);
  });
  it('returns upload validation text without attempting imports', async () => {
    database();
    vi.mocked(parseMappingUpload).mockRejectedValue(new Error('Row 2: EXAMPLE template row must be deleted or replaced'));
    const data = new FormData(); data.set('mappingFile', new File(['synthetic'], 'mapping.csv'));
    expect(await importAction({}, data)).toEqual({ error: expect.stringContaining('Row 2: EXAMPLE') });
    expect(importMappings).not.toHaveBeenCalled();
  });
  it('corrects item metadata through updateItemMaster with the guarded actor', async () => {
    const db = database();
    expect(await itemCorrectionAction({}, form({ key: 'synthetic-key', unit: 'kg', packSize: '1 kg', brand: '', category: 'Staples' }))).toHaveProperty('success');
    expect(updateItemMaster).toHaveBeenCalledWith(db.c, 'synthetic-key', { unit: 'kg', packSize: '1 kg', brand: '', category: 'Staples' }, actor);
  });
});

describe('bounded same-origin upload route', () => {
  it('rejects unauthenticated uploads before reading the body or touching DB', async () => {
    vi.mocked(requireMasterAdmin).mockRejectedValue(new Error('locked'));
    const request = new Request('https://dashboard.invalid/master/import', { method: 'POST', body: 'not-read' });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(request.bodyUsed).toBe(false);
    expect(getDb).not.toHaveBeenCalled();
  });
  it('rejects cross-origin, missing-origin and non-multipart requests', async () => {
    for (const headers of [{ origin: 'https://other.invalid' }, {}, { origin: 'https://dashboard.invalid', 'content-type': 'text/plain' }] as Record<string, string>[]) {
      const response = await POST(new Request('https://dashboard.invalid/master/import', { method: 'POST', headers, body: 'not-read' }));
      expect([403, 415]).toContain(response.status);
    }
    expect(getDb).not.toHaveBeenCalled();
  });
  it('rejects a streamed oversized body even without a Content-Length', async () => {
    const response = await POST(new Request('https://dashboard.invalid/master/import', { method: 'POST', headers: { origin: 'https://dashboard.invalid', 'content-type': 'multipart/form-data; boundary=x' }, body: new Uint8Array(2 * 1024 * 1024 + 64 * 1024 + 1) }));
    expect(response.status).toBe(413);
    expect(getDb).not.toHaveBeenCalled();
  });
  it('accepts multipart uploads above the server-action default and rechecks authorization', async () => {
    database();
    vi.mocked(parseMappingUpload).mockResolvedValue([]);
    vi.mocked(importMappings).mockResolvedValue({ inserted: 1, closed: 0, skipped: 0, districtsCreated: 0, suppliersCreated: 0 });
    const data = new FormData(); data.set('mappingFile', new File([new Uint8Array(1100 * 1024)], 'mapping.csv'));
    const response = await POST(new Request('https://dashboard.invalid/master/import', { method: 'POST', headers: { origin: 'https://dashboard.invalid' }, body: data }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: 'Mapping import complete: 1 inserted, 0 closed, 0 skipped.' });
    expect(requireMasterAdmin).toHaveBeenCalledTimes(2);
  });
});
