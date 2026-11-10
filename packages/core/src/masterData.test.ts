import { describe, expect, it, vi } from 'vitest';
import type { ClientSession } from 'mongodb';
import type { MappingDoc, MasterDataCollections } from './masterData.js';
import { isCalendarDate, mappingIntervalsOverlap, reassignDistrict, resolveHostelMapping, validateMappingIntervals } from './masterData.js';

const at = new Date('2026-01-01T00:00:00Z');
const mapping = (over: Partial<MappingDoc> = {}): MappingDoc => ({ districtCode: 'D1', godownId: 1, supplierCode: 'S1', from: '2026-01-01', to: null, createdAt: at, changedBy: 'original', ...over });
type Doc = Record<string, unknown>;
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return (value as Doc[]).some((f) => matches(doc, f));
    if (value && typeof value === 'object') return Object.entries(value).every(([op, v]) => {
      if (op === '$in') return (v as unknown[]).includes(doc[key]);
      if (op === '$lte') return String(doc[key]) <= String(v);
      if (op === '$gt') return doc[key] != null && String(doc[key]) > String(v);
      throw new Error(`Unsupported mock operator ${op}`);
    });
    return doc[key] === value;
  });
}
function database(seed: MappingDoc[] = []) {
  const state: Record<string, Doc[]> = {
    districts: ['D1', 'D2'].map((code) => ({ code, name: code, createdAt: at, updatedAt: at })),
    godowns: [1, 2].map((godownId) => ({ godownId, name: `Godown ${godownId}`, portalLogin: `GDN-${godownId}`, status: 'active', createdAt: at, updatedAt: at })),
    suppliers: ['S1', 'S2'].map((code) => ({ code, name: code, createdAt: at, updatedAt: at })),
    mappings: structuredClone(seed) as unknown as Doc[], hostelsMaster: [], auditLog: [],
  };
  const events: { name: string; operation: string; session?: ClientSession }[] = [];
  const session = {} as ClientSession;
  const tables = Object.fromEntries(Object.keys(state).map((name) => [name, {
    findOne: vi.fn(async (filter: Doc, options?: { session?: ClientSession }) => {
      events.push({ name, operation: 'findOne', session: options?.session });
      return structuredClone(state[name]!.find((d) => matches(d, filter)) ?? null);
    }),
    find: vi.fn((filter: Doc, options?: { session?: ClientSession }) => {
      events.push({ name, operation: 'find', session: options?.session });
      return { toArray: async () => structuredClone(state[name]!.filter((d) => matches(d, filter))) };
    }),
    updateOne: vi.fn(async (filter: Doc, update: { $set?: Doc }, options?: { session?: ClientSession }) => {
      events.push({ name, operation: 'update', session: options?.session });
      const doc = state[name]!.find((d) => matches(d, filter));
      if (doc) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
    }),
    insertOne: vi.fn(async (doc: Doc, options?: { session?: ClientSession }) => {
      events.push({ name, operation: 'insert', session: options?.session });
      state[name]!.push(structuredClone(doc));
      return { acknowledged: true };
    }),
  }]));
  const transaction = vi.fn(async <T>(fn: (s: ClientSession) => Promise<T>): Promise<T> => {
    const before = structuredClone(state);
    try { return await fn(session); }
    catch (e) { Object.assign(state, before); throw e; }
  });
  const c = { ...tables, transaction } as unknown as MasterDataCollections;
  return { c, state, events, session, transaction };
}
const input = { districtCode: 'D1', godownId: 2, supplierCode: 'S2', from: '2026-06-01' };

describe('mapping dates and interval invariants', () => {
  it.each(['2026-02-29', '2024-02-30', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '0000-01-01', '26-01-01', '2026-1-01', '2026-01-01T00:00:00Z', ''])('rejects non-calendar date %s', (date) => {
    expect(isCalendarDate(date)).toBe(false);
  });
  it.each(['2024-02-29', '2000-02-29', '2026-12-31', '0099-01-01'])('accepts calendar date %s', (date) => expect(isCalendarDate(date)).toBe(true));
  it('uses exclusive ends and permits gaps and adjacent supplier changes', () => {
    const a = mapping({ to: '2026-06-01' });
    const b = mapping({ from: '2026-06-01', supplierCode: 'S2' });
    expect(mappingIntervalsOverlap(a, b)).toBe(false);
    expect(() => validateMappingIntervals([a, b])).not.toThrow();
    expect(() => validateMappingIntervals([a, { ...b, from: '2026-07-01' }])).not.toThrow();
  });
  it('rejects zero-width/reversed intervals, district overlaps and conflicting godown suppliers', () => {
    expect(() => validateMappingIntervals([mapping({ to: '2026-01-01' })])).toThrow('Invalid interval');
    expect(() => validateMappingIntervals([mapping({ to: '2025-01-01' })])).toThrow('Invalid interval');
    expect(() => validateMappingIntervals([mapping(), mapping({ godownId: 2 })])).toThrow('Overlapping');
    expect(() => validateMappingIntervals([mapping(), mapping({ districtCode: 'D2', supplierCode: 'S2' })])).toThrow('different suppliers');
    expect(() => validateMappingIntervals([mapping(), mapping({ districtCode: 'D2' })])).not.toThrow();
  });
});

describe('reassignDistrict transactions', () => {
  it('splits the containing interval, retaining its scheduled end and all future mappings', async () => {
    const db = database([mapping({ to: '2026-10-01' }), mapping({ from: '2026-10-01', godownId: 2, supplierCode: 'S2' })]);
    const result = await reassignDistrict(db.c, { ...input, remarks: ' New contract ' }, 'admin');
    expect(result).toMatchObject({ ...input, to: '2026-10-01', remarks: 'New contract', changedBy: 'admin' });
    expect(db.state.mappings).toHaveLength(3);
    expect(db.state.mappings![0]).toMatchObject({ to: '2026-06-01', changedBy: 'original' });
    expect(db.state.mappings![1]).toMatchObject({ from: '2026-10-01', to: null });
    expect(db.state.auditLog![0]).toMatchObject({ actor: 'admin', action: 'mapping.reassign', target: 'D1' });
    const reads = db.events.findIndex((e) => e.name === 'mappings' && e.operation === 'find');
    expect(db.events.findIndex((e) => e.name === 'districts' && e.operation === 'update')).toBeLessThan(reads);
    expect(db.events.findIndex((e) => e.name === 'godowns' && e.operation === 'update')).toBeLessThan(reads);
    expect(db.events.every((e) => e.session === db.session)).toBe(true);
  });
  it('fills a gap only up to the next scheduled start', async () => {
    const db = database([mapping({ to: '2026-04-01' }), mapping({ from: '2026-10-01' })]);
    await expect(reassignDistrict(db.c, input, 'admin')).resolves.toMatchObject({ to: '2026-10-01' });
    expect(db.state.mappings![0]!.to).toBe('2026-04-01');
  });
  it('permits an initial mapping and a mapping at an exclusive end', async () => {
    await expect(reassignDistrict(database().c, input, 'admin')).resolves.toMatchObject({ to: null });
    const db = database([mapping({ to: input.from })]);
    await expect(reassignDistrict(db.c, input, 'admin')).resolves.toMatchObject({ to: null });
    expect(db.state.mappings![0]!.to).toBe(input.from);
  });
  it('bounds a new mapping before all existing history', async () => {
    await expect(reassignDistrict(database([mapping({ from: '2026-10-01' })]).c, input, 'admin')).resolves.toMatchObject({ to: '2026-10-01' });
  });
  it('never replaces an existing start, even with the same assignment', async () => {
    const db = database([mapping({ from: input.from })]);
    const before = structuredClone(db.state);
    await expect(reassignDistrict(db.c, input, 'admin')).rejects.toThrow('already starts');
    expect(db.state).toEqual(before);
  });
  it('rejects a cross-district supplier conflict and rolls back locks', async () => {
    const db = database([mapping(), mapping({ districtCode: 'D2', godownId: 2, supplierCode: 'S1' })]);
    const before = structuredClone(db.state);
    await expect(reassignDistrict(db.c, input, 'admin')).rejects.toThrow('different suppliers');
    expect(db.state).toEqual(before);
  });
  it.each([
    { ...input, districtCode: 'missing' }, { ...input, godownId: 99 }, { ...input, supplierCode: 'missing' },
  ])('rejects missing references %j', async (bad) => {
    const db = database([mapping()]);
    const before = structuredClone(db.state);
    await expect(reassignDistrict(db.c, bad, 'admin')).rejects.toThrow(/Unknown/);
    expect(db.state).toEqual(before);
  });
  it('rejects disabled godowns and invalid input without storing mappings', async () => {
    const db = database();
    db.state.godowns![1]!.status = 'disabled';
    await expect(reassignDistrict(db.c, input, 'admin')).rejects.toThrow('disabled');
    await expect(reassignDistrict(db.c, { ...input, from: '2026-02-30' }, 'admin')).rejects.toThrow('calendar');
    await expect(reassignDistrict(db.c, input, '')).rejects.toThrow('Actor');
    await expect(reassignDistrict(db.c, { ...input, godownId: 1.5 }, 'admin')).rejects.toThrow('valid godown');
    expect(db.state.mappings).toEqual([]);
  });
  it('guarantees a non-noop district lock even when the clock has not advanced', async () => {
    const db = database();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(at.getTime());
    try {
      await reassignDistrict(db.c, input, 'admin');
      expect(db.state.districts![0]!.updatedAt).toEqual(new Date(at.getTime() + 1));
      expect(db.state.godowns![1]!.updatedAt).toEqual(new Date(at.getTime() + 1));
    } finally { clock.mockRestore(); }
  });
  it('rolls back mapping and closure if the audit write fails', async () => {
    const db = database([mapping()]);
    const before = structuredClone(db.state);
    vi.mocked(db.c.auditLog.insertOne).mockRejectedValueOnce(new Error('Audit unavailable'));
    await expect(reassignDistrict(db.c, input, 'admin')).rejects.toThrow('Audit unavailable');
    expect(db.state).toEqual(before);
  });
  it('rechecks intervals when the parent retries a write-conflicted callback', async () => {
    const db = database([mapping()]);
    let attempt = 0;
    vi.mocked(db.c.districts.updateOne).mockImplementationOnce(async () => {
      attempt++;
      throw new Error('simulated WriteConflict');
    });
    const transaction = db.c.transaction.bind(db.c);
    db.c.transaction = async (fn) => {
      try { return await transaction(fn); }
      catch (e) {
        if ((e as Error).message !== 'simulated WriteConflict') throw e;
        db.state.mappings![0]!.to = input.from;
        db.state.mappings!.push(mapping({ ...input, to: null }) as unknown as Doc);
        return transaction(fn);
      }
    };
    await expect(reassignDistrict(db.c, input, 'admin')).rejects.toThrow('already starts');
    expect(attempt).toBe(1);
    expect(db.state.mappings).toHaveLength(2);
    expect(db.state.auditLog).toEqual([]);
  });
});

describe('resolveHostelMapping', () => {
  it('follows the hostel district, respects the boundary and never rewrites portal provenance', async () => {
    const db = database([mapping({ to: '2026-06-01' }), mapping({ from: '2026-06-01', godownId: 2, supplierCode: 'S2' })]);
    db.state.hostelsMaster!.push({ godownId: 1, hostelCode: 'H1', hostelName: 'Hostel', districtCode: 'D1', districtName: 'District', createdAt: at, updatedAt: at });
    db.state.godowns![0]!.status = 'disabled';
    const before = structuredClone(db.state);
    const key = { godownId: 1, hostelCode: 'H1' };
    expect((await resolveHostelMapping(db.c, key, '2026-05-31')).godown).toMatchObject({ godownId: 1, status: 'disabled' });
    expect(await resolveHostelMapping(db.c, key, '2026-06-01')).toMatchObject({ hostel: { godownId: 1 }, godown: { godownId: 2 }, supplier: { code: 'S2' } });
    expect(db.state).toEqual(before);
    expect(db.events.some((e) => e.operation === 'update' || e.operation === 'insert')).toBe(false);
  });
  it('returns partial nulls for gaps/missing references and all nulls for missing hostels', async () => {
    const db = database([mapping({ to: '2026-03-01' })]);
    const key = { godownId: 1, hostelCode: 'H1' };
    expect(await resolveHostelMapping(db.c, key, '2026-06-01')).toEqual({ hostel: null, district: null, godown: null, supplier: null, mapping: null });
    db.state.hostelsMaster!.push({ ...key, districtCode: 'D1' });
    expect(await resolveHostelMapping(db.c, key, '2026-06-01')).toMatchObject({ hostel: key, district: { code: 'D1' }, mapping: null, godown: null, supplier: null });
    db.state.suppliers = [];
    expect(await resolveHostelMapping(db.c, key, '2026-01-01')).toMatchObject({ supplier: null, mapping: { supplierCode: 'S1' } });
    await expect(resolveHostelMapping(db.c, key, '2026-02-30')).rejects.toThrow('calendar');
  });
  it('fails explicitly rather than choosing an arbitrary overlapping mapping', async () => {
    const db = database([mapping(), mapping({ from: '2026-02-01' })]);
    db.state.hostelsMaster!.push({ godownId: 1, hostelCode: 'H1', districtCode: 'D1' });
    await expect(resolveHostelMapping(db.c, { godownId: 1, hostelCode: 'H1' }, '2026-06-01')).rejects.toThrow('Overlapping');
  });
});
