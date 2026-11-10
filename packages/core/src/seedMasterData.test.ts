import { describe, expect, it, vi } from 'vitest';
import type { Collections } from './db.js';
import { seedMasterData } from './seedMasterData.js';

function catalog(duplicate = false) {
  const session = {};
  const table = () => ({ updateOne: vi.fn(async () => ({ matchedCount: 1 })) });
  const godowns = table(), hostelsMaster = table(), districts = table();
  const auditLog = { insertOne: vi.fn(async () => ({})) };
  const accounts = { find: vi.fn(() => ({ toArray: async () => [
    { username: 'GDN-TEST', status: 'active', godowns: [{ id: 1, name: 'Test Godown' }] },
    ...(duplicate ? [{ username: 'GDN-OTHER', status: 'active', godowns: [{ id: 1, name: 'Test Godown' }] }] : []),
  ] })) };
  const requests = { aggregate: vi.fn(() => ({ toArray: async () => [{ godownId: 1, hostelCode: 'H1', hostelName: 'Test Hostel', districtName: 'Test District' }] })) };
  const transaction = vi.fn(async (fn: (session: unknown) => Promise<unknown>) => fn(session));
  return { c: { accounts, requests, godowns, hostelsMaster, districts, auditLog, transaction } as unknown as Collections, session, accounts, godowns, hostelsMaster, districts, auditLog };
}

describe('stored master bootstrap', () => {
  it('seeds only identities without invented assignments, credentials or destructive updates', async () => {
    const db = catalog();
    expect(await seedMasterData(db.c, 'master-admin')).toEqual({ godowns: 1, hostels: 1, districts: 1 });
    expect(db.accounts.find).toHaveBeenCalledWith({}, { session: db.session, projection: { username: 1, status: 1, godowns: 1 } });
    for (const table of [db.godowns, db.hostelsMaster, db.districts]) {
      expect(table.updateOne).toHaveBeenCalledOnce();
      const call = table.updateOne.mock.calls[0] as unknown as [unknown, Record<string, unknown>, unknown];
      expect(Object.keys(call[1])).toEqual(['$setOnInsert']);
      expect(call[2]).toEqual({ upsert: true, session: db.session });
      expect(JSON.stringify(call[1])).not.toMatch(/password|token|supplier/);
    }
    expect(db.auditLog.insertOne).toHaveBeenCalledWith(expect.objectContaining({ actor: 'master-admin', action: 'master.bootstrap' }), { session: db.session });
  });
  it('rejects ambiguous stored godown logins before writing anything', async () => {
    const db = catalog(true);
    await expect(seedMasterData(db.c, 'master-admin')).rejects.toThrow('multiple stored logins');
    expect(db.godowns.updateOne).not.toHaveBeenCalled();
    expect(db.auditLog.insertOne).not.toHaveBeenCalled();
  });
  it('requires an audit actor', async () => {
    const db = catalog();
    await expect(seedMasterData(db.c, '')).rejects.toThrow('Actor');
    expect(db.c.transaction).not.toHaveBeenCalled();
  });
});
