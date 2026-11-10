import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { comparisonItems, effectiveItemMetadata, itemVariantKey, quantityLabel, requestItemSnapshots, syncItemMasters, updateItemMaster } from './itemMaster.js';
import type { ItemMasterCollections, RequestItemSnapshot } from './itemMaster.js';
import type { AccountDoc, Collections } from './db.js';
import type { MasterDataCollections } from './masterData.js';
import * as portal from './portalClient.js';
import * as accounts from './accounts.js';
import * as orders from './orders.js';
import { normalizedDistrictCode, syncAccount, syncReportMasters, syncRequestItems } from './sync.js';
import { parseGodownRows } from './parser.js';

const snapshot = (patch: Partial<RequestItemSnapshot> = {}): RequestItemSnapshot => ({
  sourceKey: 'Rice', name: 'Rice', unit: 'kg', requestedQuantity: 10, ...patch,
});

describe('item identities and snapshots', () => {
  it('normalizes names/spacing but never converts units or pack sizes', () => {
    expect(itemVariantKey(snapshot({ name: ' Rice (Fine) ', unit: ' KG ', packSize: '200 g' })))
      .toBe(itemVariantKey(snapshot({ name: 'ricefine', unit: 'kg', packSize: '200g' })));
    const keys = ['200g', '250g', '0.2kg', '2.00g', '200.g'].map((packSize) => itemVariantKey(snapshot({ packSize })));
    expect(new Set(keys).size).toBe(keys.length);
    expect(itemVariantKey(snapshot({ unit: 'kg' }))).not.toBe(itemVariantKey(snapshot({ unit: 'pack' })));
    expect(quantityLabel(snapshot({ unit: 'pack', packSize: '200g' }))).toBe('pack / 200g');
    expect(quantityLabel({})).toBe('unit unknown');
  });

  it('uses raw report quantities and leaves raw data unchanged', () => {
    const s = snapshot({ requestedQuantity: 400, suppliedQuantity: 300, finalQuantity: 200 });
    const request = { items: { Rice: 10, Unknown: 0 }, itemSnapshots: [s] };
    expect(comparisonItems(request)).toEqual({ [itemVariantKey(s)]: 10, Unknown: 0 });
    expect(request.items).toEqual({ Rice: 10, Unknown: 0 });
    expect(request.itemSnapshots).toEqual([s]);
    expect(comparisonItems({ items: { Rice: 10 } })).toEqual({ Rice: 10 });
    expect(comparisonItems({ items: { Rice: 10 }, itemSnapshots: [] })).toEqual({ Rice: 10 });
    expect(comparisonItems({ items: { Rice: 10 }, itemSnapshots: [s, s] })).toEqual({ Rice: 10 });
  });

  it('maps only unique alphanumeric names, not aliases or ambiguous variants', () => {
    const rows = [snapshot({ name: 'Rice (Fine)' })];
    expect(requestItemSnapshots({ RiceFine: 10 }, rows)[0]).toMatchObject({ sourceKey: 'RiceFine', unit: 'kg' });
    expect(requestItemSnapshots({ Rice: 10 }, rows)[0]?.unit).toBeUndefined();
    expect(requestItemSnapshots({ RiceFine: 10 }, [...rows, { ...rows[0]!, unit: 'pack' }])[0]?.unit).toBeUndefined();
    expect(requestItemSnapshots({ RiceFine: 10, 'Rice Fine': 20 }, rows).every((s) => !s.unit)).toBe(true);
    expect(requestItemSnapshots({ Missing: 5 }, [])[0]).toEqual({ sourceKey: 'Missing', name: 'Missing', requestedQuantity: 5 });
  });

  it('keeps observed metadata immutable and preserves manual corrections on refresh', async () => {
    const bulkWrite = vi.fn().mockResolvedValue({});
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const insertOne = vi.fn().mockResolvedValue({});
    const c = { itemsMaster: { bulkWrite, updateOne }, auditLog: { insertOne } } as unknown as ItemMasterCollections;
    const s = snapshot({ brand: 'Observed', category: 'Grain' });
    await syncItemMasters(c, [s, s]);
    expect(bulkWrite.mock.calls[0]![0]).toHaveLength(1);
    const update = bulkWrite.mock.calls[0]![0][0].updateOne.update;
    expect(update.$set).toEqual({ lastSeenAt: expect.any(Date) });
    expect(update.$setOnInsert).toMatchObject({ name: 'Rice', unit: 'kg', brand: 'Observed' });
    expect(update.$setOnInsert).not.toHaveProperty('requestedQuantity');
    await updateItemMaster(c, itemVariantKey(s), { unit: 'pack', packSize: '250g' }, 'operator');
    expect(updateOne).toHaveBeenCalledWith({ key: itemVariantKey(s) }, { $set: {
      'override.unit': 'pack', 'override.packSize': '250g', overrideBy: 'operator', overrideAt: expect.any(Date),
    } });
    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ actor: 'operator', action: 'item.update' }));
    expect(effectiveItemMetadata({ ...s, override: { unit: 'pack', brand: '' } })).toEqual({ unit: 'pack', brand: '', category: 'Grain' });
    await expect(updateItemMaster(c, 'key', { unit: 'kg' }, '')).rejects.toThrow('Actor');
    updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    await expect(updateItemMaster(c, 'missing', { unit: 'kg' }, 'actor')).rejects.toThrow('Unknown item');
  });
});

const acct = { username: 'GDN-TEST', godowns: [{ id: 2, name: 'Test Godown' }] } as AccountDoc;
const rawReport = {
  request_id: 'IR-1', request_date: '04-11-2026', month_name: 'November', status: 'Pending',
  hostel_name: 'H1-Test Hostel', district_name: 'Test District', godown_name: 'Test Godown',
  godown_contact_person: 'Business Contact', godown_contact_no: '0400000000', mobile: '0401111111', Rice: 10,
};

function memoryCollections(requests: Record<string, unknown>[] = []) {
  const updates = vi.fn(async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
    const r = requests.find((r) => r.godownId === filter.godownId && r.requestId === filter.requestId);
    if (r) Object.assign(r, update.$set);
    return { matchedCount: r ? 1 : 0 };
  });
  const limit = vi.fn();
  const find = vi.fn((filter: Record<string, unknown>) => {
    let cap = Infinity;
    const cursor = {
      sort: vi.fn(() => cursor),
      limit: (n: number) => { cap = n; limit(n); return cursor; },
      toArray: async () => requests.filter((r) =>
        !('itemMetadataSyncedAt' in r) && !('itemSnapshots' in r) &&
        (filter.godownId as { $in: number[] }).$in.includes(r.godownId as number),
      ).slice(0, cap),
    };
    return cursor;
  });
  const bulkWrite = vi.fn().mockResolvedValue({});
  const hostelsMaster = { updateOne: vi.fn().mockResolvedValue({}) };
  const godowns = { updateOne: vi.fn().mockResolvedValue({}), bulkWrite: vi.fn().mockResolvedValue({}) };
  const c = {
    requests: { find, updateOne: updates, bulkWrite, distinct: async () => [] }, itemsMaster: { bulkWrite: vi.fn().mockResolvedValue({}) },
    hostelsMaster, godowns, accounts: { updateOne: vi.fn().mockResolvedValue({}) },
    hostels: { find: () => ({ toArray: async () => [] }) },
  } as unknown as Collections & ItemMasterCollections & Pick<MasterDataCollections, 'hostelsMaster' | 'godowns'>;
  return { c, updates, find, limit, bulkWrite, hostelsMaster, godowns };
}
const request = (id = 'IR-1') => ({ ...parseGodownRows([rawReport], 2)[0]!, requestId: id });

// All portal reads are mocked; the default fetch stub also blocks accidental network access.
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected portal read in test')));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('metadata synchronization', () => {
  it('hydrates once, including empty reads, without replacing raw items', async () => {
    const r = request(), { c, updates } = memoryCollections([r]);
    const fetchItems = vi.spyOn(portal, 'fetchRequestItems').mockResolvedValue([]);
    const first = syncRequestItems(c, acct, 'token');
    await vi.runAllTimersAsync();
    expect(await first).toBe(1);
    expect(updates).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'IR-1' }), { $set: {
      itemSnapshots: [{ sourceKey: 'Rice', name: 'Rice', requestedQuantity: 10 }], itemMetadataSyncedAt: expect.any(Date),
    } });
    expect(r.items).toEqual({ Rice: 10 });
    expect(await syncRequestItems(c, acct, 'token')).toBe(0);
    expect(fetchItems).toHaveBeenCalledTimes(1);
  });

  it('retains quantities and strips remark fields from stored snapshots', async () => {
    const { c, updates } = memoryCollections([request()]);
    vi.spyOn(portal, 'fetchRequestItems').mockResolvedValue([{ ...snapshot({ suppliedQuantity: 9 }), remarks: 'business remark' }]);
    const pending = syncRequestItems(c, acct, 'token');
    await vi.runAllTimersAsync(); await pending;
    const s = updates.mock.calls[0]![1].$set.itemSnapshots as RequestItemSnapshot[];
    expect(s[0]).toMatchObject({ sourceKey: 'Rice', unit: 'kg', suppliedQuantity: 9 });
    expect(s[0]).not.toHaveProperty('remarks');
  });

  it('catalogs ambiguous observed variants without guessing a report-key allocation', async () => {
    const { c, updates } = memoryCollections([request()]);
    vi.spyOn(portal, 'fetchRequestItems').mockResolvedValue([
      snapshot({ unit: 'pack', packSize: '200g' }), snapshot({ unit: 'pack', packSize: '250g' }),
    ]);
    const pending = syncRequestItems(c, acct, 'token');
    await vi.runAllTimersAsync(); await pending;
    expect(updates.mock.calls[0]![1].$set.itemSnapshots).toEqual([{ sourceKey: 'Rice', name: 'Rice', requestedQuantity: 10 }]);
    const bulk = vi.mocked((c as unknown as ItemMasterCollections).itemsMaster.bulkWrite);
    expect(bulk.mock.calls[0]![0]).toHaveLength(2);
  });

  it('retries failures later but propagates auth failures without a completion stamp', async () => {
    const { c, updates } = memoryCollections([request()]);
    const fetchItems = vi.spyOn(portal, 'fetchRequestItems').mockRejectedValueOnce(new Error('temporary'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = syncRequestItems(c, acct, 'token');
    await vi.runAllTimersAsync();
    expect(await pending).toBe(0); expect(updates).not.toHaveBeenCalled();
    fetchItems.mockRejectedValueOnce(new portal.PortalAuthError('401'));
    await expect(syncRequestItems(c, acct, 'token')).rejects.toThrow(portal.PortalAuthError);
    expect(updates).not.toHaveBeenCalled();
  });

  it('caps attempts at 40 for the whole account, excluding completed requests and other godowns', async () => {
    const records = Array.from({ length: 45 }, (_, i) => request(`IR-${i}`));
    const { c, limit } = memoryCollections([
      { ...request('completed'), itemSnapshots: [] }, { ...request('other'), godownId: 99 }, ...records,
    ]);
    const fetchItems = vi.spyOn(portal, 'fetchRequestItems').mockResolvedValue([]);
    const pending = syncRequestItems(c, acct, 'token');
    await vi.runAllTimersAsync();
    expect(await pending).toBe(40); expect(limit).toHaveBeenCalledWith(40); expect(fetchItems).toHaveBeenCalledTimes(40);
  });

  it('fills nonempty business contacts only into blank master fields', async () => {
    const { c, hostelsMaster, godowns } = memoryCollections();
    await syncReportMasters(c, acct, [rawReport], parseGodownRows([rawReport], 2));
    expect(hostelsMaster.updateOne).toHaveBeenCalledWith(
      { godownId: 2, hostelCode: 'H1' },
      expect.objectContaining({ $set: expect.objectContaining({ districtName: 'Test District', districtCode: normalizedDistrictCode('Test District') }) }),
      { upsert: true },
    );
    expect(hostelsMaster.updateOne).toHaveBeenCalledWith(
      { godownId: 2, hostelCode: 'H1', $or: [{ hostelPhone: { $exists: false } }, { hostelPhone: { $type: 'null' } }, { hostelPhone: '' }] },
      { $set: { hostelPhone: '0401111111', updatedAt: expect.any(Date) } },
    );
    expect(godowns.updateOne).toHaveBeenCalledWith(
      { godownId: 2, $or: [{ contactPhone: { $exists: false } }, { contactPhone: { $type: 'null' } }, { contactPhone: '' }] },
      { $set: { contactPhone: '0400000000', updatedAt: expect.any(Date) } },
    );
    hostelsMaster.updateOne.mockClear(); godowns.updateOne.mockClear();
    const empty = { ...rawReport, mobile: '', godown_contact_person: '', godown_contact_no: '' };
    await syncReportMasters(c, acct, [empty], parseGodownRows([empty], 2));
    expect(hostelsMaster.updateOne).toHaveBeenCalledTimes(1);
    expect(godowns.updateOne).toHaveBeenCalledTimes(1);
    expect(normalizedDistrictCode(' Test  District ')).toBe(normalizedDistrictCode('test district'));
  });

  it('deduplicates master writes across repeated report requests while accepting later nonempty phones', async () => {
    const { c, hostelsMaster, godowns } = memoryCollections();
    const empty = { ...rawReport, mobile: '', godown_contact_person: '', godown_contact_no: '' };
    const rows = [empty, rawReport, rawReport];
    await syncReportMasters(c, acct, rows, parseGodownRows(rows, 2));
    expect(hostelsMaster.updateOne).toHaveBeenCalledTimes(2); // one master upsert and one contact fill
    expect(godowns.updateOne).toHaveBeenCalledTimes(3); // one master upsert and two contact fills
  });

  it('report upserts never erase existing snapshots or hydration timestamps', async () => {
    const { c, bulkWrite } = memoryCollections();
    vi.spyOn(accounts, 'getToken').mockResolvedValue('token');
    vi.spyOn(portal, 'fetchGodownMonth').mockResolvedValue([rawReport]);
    vi.spyOn(orders, 'syncOrders').mockResolvedValue(0);
    const pending = syncAccount(c, acct, ['NOVEMBER']);
    await vi.runAllTimersAsync(); await pending;
    const set = bulkWrite.mock.calls[0]![0][0].updateOne.update.$set;
    expect(set.items).toEqual({ Rice: 10 });
    expect(set).not.toHaveProperty('itemSnapshots');
    expect(set).not.toHaveProperty('itemMetadataSyncedAt');
  });

  it('verified account discovery upserts godowns without contacts or district assignments', async () => {
    const { c, godowns } = memoryCollections();
    vi.stubEnv('CREDENTIAL_ENC_KEY', 'a'.repeat(64));
    vi.spyOn(portal, 'portalLogin').mockResolvedValue({ token: 'token', createdAt: new Date(), expiresAt: new Date() });
    vi.spyOn(portal, 'fetchGodownsForUser').mockResolvedValue(acct.godowns);
    try {
      await accounts.addAccount(c, acct.username, 'test-password');
      const update = godowns.bulkWrite.mock.calls[0]![0][0].updateOne.update;
      expect(update.$set).toEqual({ portalLogin: acct.username, name: 'Test Godown', updatedAt: expect.any(Date) });
      expect(update.$setOnInsert).toEqual({ godownId: 2, status: 'active', createdAt: expect.any(Date) });
    } finally { vi.unstubAllEnvs(); }
  });
});
