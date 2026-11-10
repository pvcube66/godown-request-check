import { describe, expect, it, vi } from 'vitest';
import type { ClientSession } from 'mongodb';
import type { MappingDoc, MasterDataCollections } from './masterData.js';
import { importMappings, MAPPING_HEADERS, MappingValidationError, normalizeMappingRows, parseMappingCsv } from './mappingImport.js';
import type { NormalizedMappingRow } from './mappingImport.js';

const at = new Date('2026-01-01T00:00:00Z');
const row = (over: Partial<NormalizedMappingRow> = {}): NormalizedMappingRow => ({ rowNumber: 2, districtName: 'District One', godownName: 'Godown One', portalLogin: 'GDN-ONE', supplierName: 'Supplier One', from: '2026-01-01', to: null, ...over });
const mapping = (over: Partial<MappingDoc> = {}): MappingDoc => ({ districtCode: 'D1', godownId: 10, supplierCode: 'S1', from: '2026-01-01', to: null, createdAt: at, changedBy: 'original', ...over });
type Doc = Record<string, unknown>;
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$or') return (v as Doc[]).some((f) => matches(doc, f));
    if (v && typeof v === 'object' && '$in' in v) return (v.$in as unknown[]).includes(doc[k]);
    return doc[k] === v;
  });
}
function database(seed: MappingDoc[] = []) {
  const state: Record<string, Doc[]> = {
    districts: [{ code: 'D1', name: 'District One', createdAt: at, updatedAt: at }, { code: 'D2', name: 'District Two', createdAt: at, updatedAt: at }],
    suppliers: [{ code: 'S1', name: 'Supplier One', createdAt: at, updatedAt: at }, { code: 'S2', name: 'Supplier Two', createdAt: at, updatedAt: at }],
    godowns: [
      { godownId: 10, portalLogin: 'GDN-ONE', name: 'Godown One', status: 'active', createdAt: at, updatedAt: at },
      { godownId: 20, portalLogin: 'GDN-TWO', name: 'Godown Two', status: 'active', createdAt: at, updatedAt: at },
    ],
    mappings: structuredClone(seed) as unknown as Doc[], hostelsMaster: [], auditLog: [],
  };
  const events: { name: string; operation: string; session?: ClientSession; filter?: Doc }[] = [];
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
    updateOne: vi.fn(async (filter: Doc, update: { $set?: Doc; $setOnInsert?: Doc }, options?: { session?: ClientSession; upsert?: boolean }) => {
      events.push({ name, operation: 'update', session: options?.session, filter });
      const doc = state[name]!.find((d) => matches(d, filter));
      if (doc) Object.assign(doc, update.$set);
      else if (options?.upsert) state[name]!.push(structuredClone({ ...filter, ...update.$setOnInsert, ...update.$set }));
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
const raw = (over: string[] = []) => [['District One', 'Godown One', 'GDN-ONE', 'Supplier One', '2026-01-01', '', '', ''].map((v, i) => over[i] ?? v)];
const otherGodown = { godownName: 'Godown Two', portalLogin: 'GDN-TWO', supplierName: 'Supplier Two' };

describe('parseMappingCsv', () => {
  it('handles BOM, CRLF, quoted commas, doubled quotes, empty cells and embedded newlines', () => {
    expect(parseMappingCsv('\uFEFFa,b,c\r\n"District, One","said ""yes""","line 1\r\nline 2"\r\n,,')).toEqual([
      ['a', 'b', 'c'], ['District, One', 'said "yes"', 'line 1\nline 2'], ['', '', ''],
    ]);
    expect(parseMappingCsv('a,b\n')).toEqual([['a', 'b']]);
    expect(parseMappingCsv('""')).toEqual([['']]);
    expect(parseMappingCsv('')).toEqual([]);
  });
  it.each(['"unterminated', 'a"b,c', '"a"b,c', '"a""'])('rejects malformed CSV %s', (csv) => {
    expect(() => parseMappingCsv(csv)).toThrow(MappingValidationError);
  });
});

describe('normalizeMappingRows', () => {
  it('reads exact template headers and ignores blanks and Notes-only instructions', () => {
    expect(normalizeMappingRows([[...MAPPING_HEADERS], ...raw(), [], ['', '', '', '', '', '', '', 'A godown may serve many districts']])).toEqual([row()]);
  });
  it('normalizes header case, BOM and whitespace, reorders columns and accepts practical aliases', () => {
    expect(normalizeMappingRows([
      [], ['\uFEFF  SUPPLIER   NAME ', 'District', 'Portal Login', 'Godown', 'Start Date', 'End Date'],
      [' Supplier One ', ' District   One ', ' gdn-one ', 'Godown One', '2026-01-01', ''],
    ])).toEqual([row({ rowNumber: 3, portalLogin: 'gdn-one' })]);
  });
  it('rejects the real template EXAMPLE row, including example in a Notes-only row', () => {
    expect(() => normalizeMappingRows([[...MAPPING_HEADERS], ['EXAMPLE: delete this row', 'EXAMPLE godown', 'GDN-XXX', 'EXAMPLE supplier', '2026-06-01', '', '', '33 districts in total. One row per district.']])).toThrow('Row 2: EXAMPLE');
    expect(() => normalizeMappingRows([[...MAPPING_HEADERS], ['', '', '', '', '', '', '', 'EXAMPLE']])).toThrow('EXAMPLE');
  });
  it('aggregates numbered row errors rather than silently accepting partial data', () => {
    try {
      normalizeMappingRows([[...MAPPING_HEADERS], ...raw(['', 'Godown One', 'GDN-ONE', 'Supplier One', '2026-02-30']), ...raw(['District Two', '', 'GDN-ONE', 'Supplier One', '2026-03-01', '2026-03-01'])]);
      expect.fail('Expected validation error');
    } catch (e) {
      expect(e).toBeInstanceOf(MappingValidationError);
      expect((e as MappingValidationError).errors.join('\n')).toMatch(/Row 2:.*required/);
      expect((e as Error).message).toMatch(/Row 2:.*calendar/);
      expect((e as Error).message).toMatch(/Row 3:.*end-exclusive/);
    }
  });
  it('rejects duplicate or missing headers and data in unknown columns', () => {
    expect(() => normalizeMappingRows([])).toThrow('empty');
    expect(() => normalizeMappingRows([['District']])).toThrow('missing');
    expect(() => normalizeMappingRows([[...MAPPING_HEADERS, 'district']])).toThrow('duplicate');
    expect(() => normalizeMappingRows([[...MAPPING_HEADERS, 'unrecognized'], [...raw()[0]!, 'important data']])).toThrow('unrecognized');
  });
  it('rejects duplicate starts and overlapping districts in the file but accepts adjacency and gaps', () => {
    expect(() => normalizeMappingRows([[...MAPPING_HEADERS], ...raw(), ...raw()])).toThrow('Rows 2, 3');
    expect(() => normalizeMappingRows([[...MAPPING_HEADERS], ...raw(['District One', 'Godown One', 'GDN-ONE', 'Supplier One', '2026-01-01', '2026-03-01']), ...raw(['District One', 'Godown One', 'GDN-ONE', 'Supplier One', '2026-03-01'])])).not.toThrow();
    expect(() => normalizeMappingRows([[...MAPPING_HEADERS], ...raw(['District One', 'Godown One', 'GDN-ONE', 'Supplier One', '2026-01-01', '2026-03-01']), ...raw(['District One', 'Godown One', 'GDN-ONE', 'Supplier One', '2026-04-01'])])).not.toThrow();
  });
  it('rejects more than 500 data rows, but does not count blank/note-only rows', () => {
    const data = Array.from({ length: 501 }, (_, i) => [...raw([`District ${i}`])[0]!]);
    expect(() => normalizeMappingRows([[...MAPPING_HEADERS], ...data])).toThrow('500');
    expect(normalizeMappingRows([[...MAPPING_HEADERS], ...Array.from({ length: 501 }, () => ['', '', '', '', '', '', '', 'Notes only'])])).toEqual([]);
  });
});

describe('importMappings', () => {
  it('imports new masters using real portal godown IDs and audits in the same transaction', async () => {
    const db = database();
    const result = await importMappings(db.c, [row({ districtName: 'New District', supplierName: 'New Supplier', remarks: 'Contract' })], 'admin');
    expect(result).toEqual({ inserted: 1, closed: 0, skipped: 0, districtsCreated: 1, suppliersCreated: 1 });
    expect(db.state.districts).toHaveLength(3);
    expect(db.state.suppliers).toHaveLength(3);
    expect(db.state.godowns).toHaveLength(2);
    expect(db.state.mappings![0]).toMatchObject({ godownId: 10, remarks: 'Contract', changedBy: 'admin' });
    expect(db.state.auditLog![0]).toMatchObject({ actor: 'admin', action: 'mapping.import', target: 'mappings' });
    expect(db.events.every((e) => e.session === db.session)).toBe(true);
    const intervalRead = db.events.findIndex((e) => e.name === 'mappings' && e.operation === 'find');
    expect(db.events.findIndex((e) => e.name === 'districts' && e.operation === 'update')).toBeLessThan(intervalRead);
    expect(db.events.findIndex((e) => e.name === 'godowns' && e.operation === 'update')).toBeLessThan(intervalRead);
  });
  it('reuses master names case/whitespace-insensitively and generates stable codes on another import', async () => {
    const db = database();
    const result = await importMappings(db.c, [row({ districtName: ' district   one ', godownName: 'GODOWN ONE', portalLogin: 'gdn-one', supplierName: 'SUPPLIER ONE' })], 'admin');
    expect(result).toMatchObject({ districtsCreated: 0, suppliersCreated: 0 });
    expect(db.state.mappings![0]).toMatchObject({ districtCode: 'D1', supplierCode: 'S1', godownId: 10 });
    const a = database(), b = database();
    await importMappings(a.c, [row({ districtName: 'New District', supplierName: 'New Supplier' })], 'admin');
    await importMappings(b.c, [row({ districtName: 'NEW DISTRICT', supplierName: 'new   supplier' })], 'admin');
    expect(a.state.mappings![0]!.districtCode).toBe(b.state.mappings![0]!.districtCode);
    expect(a.state.mappings![0]!.supplierCode).toBe(b.state.mappings![0]!.supplierCode);
  });
  it('treats exact repeats as no mutation, including timestamps, actor and audit', async () => {
    const db = database([mapping({ remarks: 'Contract' })]);
    const before = structuredClone(db.state);
    expect(await importMappings(db.c, [row({ remarks: 'Contract' })], 'another-admin')).toEqual({ inserted: 0, closed: 0, skipped: 1, districtsCreated: 0, suppliersCreated: 0 });
    expect(db.state).toEqual(before);
    expect(db.c.mappings.insertOne).not.toHaveBeenCalled();
    expect(db.c.auditLog.insertOne).not.toHaveBeenCalled();
  });
  it('closes only an unchanged open interval with a supplied adjacent successor, preserving history', async () => {
    const db = database([mapping()]);
    const rows = [row({ to: '2026-06-01' }), row({ rowNumber: 3, ...otherGodown, from: '2026-06-01' })];
    expect(await importMappings(db.c, rows, 'admin')).toMatchObject({ inserted: 1, closed: 1 });
    expect(db.state.mappings).toHaveLength(2);
    expect(db.state.mappings![0]).toMatchObject({ from: '2026-01-01', to: '2026-06-01', changedBy: 'original', createdAt: at });
    expect(db.state.mappings![1]).toMatchObject({ godownId: 20, supplierCode: 'S2', from: '2026-06-01', to: null });
    const before = structuredClone(db.state);
    expect(await importMappings(db.c, rows, 'admin')).toMatchObject({ inserted: 0, closed: 0, skipped: 2 });
    expect(db.state).toEqual(before);
  });
  it('is independent of input order when closing an interval', async () => {
    const db = database([mapping()]);
    await expect(importMappings(db.c, [row({ rowNumber: 2, ...otherGodown, from: '2026-06-01' }), row({ rowNumber: 3, to: '2026-06-01' })], 'admin')).resolves.toMatchObject({ closed: 1, inserted: 1 });
  });
  it.each([
    [row({ to: '2026-06-01' })],
    [row({ to: '2026-06-01' }), row({ rowNumber: 3, ...otherGodown, from: '2026-07-01' })],
    [row({ ...otherGodown })], [row({ remarks: 'Changed history' })],
    [row({ from: '2026-06-01' })],
  ])('rejects history rewrites, non-adjacent closes and DB overlap %#', async (...rows) => {
    const db = database([mapping()]);
    const before = structuredClone(db.state);
    await expect(importMappings(db.c, rows, 'admin')).rejects.toBeInstanceOf(MappingValidationError);
    expect(db.state).toEqual(before);
  });
  it('never changes a finite historical end, even with an adjacent successor', async () => {
    const db = database([mapping({ to: '2026-05-01' })]);
    await expect(importMappings(db.c, [row({ to: '2026-06-01' }), row({ rowNumber: 3, ...otherGodown, from: '2026-06-01' })], 'admin')).rejects.toThrow('history cannot be overwritten');
    expect(db.state.mappings![0]!.to).toBe('2026-05-01');
  });
  it('accepts an explicit gap, a finite new interval and exact exclusive boundaries', async () => {
    const db = database([mapping({ to: '2026-03-01' })]);
    await expect(importMappings(db.c, [row({ ...otherGodown, from: '2026-04-01', to: '2026-06-01' }), row({ rowNumber: 3, from: '2026-06-01' })], 'admin')).resolves.toMatchObject({ inserted: 2 });
    expect(db.state.mappings).toHaveLength(3);
    expect(db.state.mappings![0]!.to).toBe('2026-03-01');
  });
  it('validates all rows before entering the transaction, including direct normalized input', async () => {
    const db = database();
    await expect(importMappings(db.c, [row(), row({ rowNumber: 8, districtName: 'District Two', from: '2026-02-30' })], 'admin')).rejects.toThrow('Row 8');
    await expect(importMappings(db.c, [row({ districtName: 'EXAMPLE' })], 'admin')).rejects.toThrow('EXAMPLE');
    await expect(importMappings(db.c, [row(), row({ rowNumber: 3 })], 'admin')).rejects.toThrow('Rows 2, 3');
    await expect(importMappings(db.c, Array.from({ length: 501 }, (_, i) => row({ districtName: `D${i}`, rowNumber: i + 2 })), 'admin')).rejects.toThrow('500');
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it('aggregates unknown/mismatched portal catalog references without creating godowns', async () => {
    const db = database();
    const before = structuredClone(db.state);
    await expect(importMappings(db.c, [row({ portalLogin: 'GDN-NOT-REAL' }), row({ rowNumber: 9, districtName: 'New District', godownName: 'Wrong Name' })], 'admin')).rejects.toThrow(/Row 2:[\s\S]*Row 9:/);
    expect(db.state).toEqual(before);
  });
  it('rejects disabled or ambiguous portal godowns and ambiguous master names', async () => {
    for (const kind of ['disabled', 'godown', 'district', 'supplier']) {
      const db = database();
      if (kind === 'disabled') db.state.godowns![0]!.status = 'disabled';
      if (kind === 'godown') db.state.godowns!.push({ ...db.state.godowns![0]!, godownId: 99 });
      if (kind === 'district') db.state.districts!.push({ ...db.state.districts![0]!, code: 'D99' });
      if (kind === 'supplier') db.state.suppliers!.push({ ...db.state.suppliers![0]!, code: 'S99' });
      await expect(importMappings(db.c, [row()], 'admin')).rejects.toThrow(/active portal godown|ambiguous/);
      expect(db.state.mappings).toEqual([]);
    }
  });
  it('enforces one supplier per godown in both file and DB across different districts', async () => {
    const fileDb = database();
    await expect(importMappings(fileDb.c, [row(), row({ rowNumber: 3, districtName: 'District Two', supplierName: 'Supplier Two' })], 'admin')).rejects.toThrow('different suppliers');
    expect(fileDb.transaction).not.toHaveBeenCalled();
    const db = database([mapping({ districtCode: 'D2', supplierCode: 'S2' })]);
    await expect(importMappings(db.c, [row()], 'admin')).rejects.toThrow('different suppliers');
    expect(db.state.mappings).toHaveLength(1);
    const allowed = database([mapping({ districtCode: 'D2', supplierCode: 'S2', to: '2026-06-01' })]);
    await expect(importMappings(allowed.c, [row({ from: '2026-06-01' })], 'admin')).resolves.toMatchObject({ inserted: 1 });
  });
  it('resolves separate godowns under one portal login by name, without conflating their suppliers', async () => {
    const db = database();
    db.state.godowns![1]!.portalLogin = 'GDN-ONE';
    const rows = [row(), row({ rowNumber: 3, districtName: 'District Two', godownName: 'Godown Two', portalLogin: 'GDN-ONE', supplierName: 'Supplier Two' })];
    await expect(importMappings(db.c, rows, 'admin')).resolves.toMatchObject({ inserted: 2 });
    expect(db.state.mappings!.map((m) => [m.godownId, m.supplierCode])).toEqual([[10, 'S1'], [20, 'S2']]);
  });
  it('permits the same supplier serving a godown for overlapping districts', async () => {
    const db = database();
    await expect(importMappings(db.c, [row(), row({ rowNumber: 3, districtName: 'District Two' })], 'admin')).resolves.toMatchObject({ inserted: 2 });
  });
  it('rolls back masters, mapping changes and audit when any write fails', async () => {
    const db = database();
    const before = structuredClone(db.state);
    vi.mocked(db.c.auditLog.insertOne).mockRejectedValueOnce(new Error('audit failure'));
    await expect(importMappings(db.c, [row({ districtName: 'New District', supplierName: 'New Supplier' })], 'admin')).rejects.toThrow('audit failure');
    expect(db.state).toEqual(before);
  });
  it('locks shared godowns and revalidates against a competing district after a transaction retry', async () => {
    const db = database();
    vi.mocked(db.c.godowns.updateOne).mockRejectedValueOnce(new Error('simulated WriteConflict'));
    const transaction = db.c.transaction.bind(db.c);
    db.c.transaction = async (fn) => {
      try { return await transaction(fn); }
      catch (e) {
        if ((e as Error).message !== 'simulated WriteConflict') throw e;
        db.state.mappings!.push(mapping({ districtCode: 'D2', supplierCode: 'S2' }) as unknown as Doc);
        return transaction(fn);
      }
    };
    await expect(importMappings(db.c, [row()], 'admin')).rejects.toThrow('different suppliers');
    expect(db.state.mappings).toHaveLength(1);
    expect(db.state.auditLog).toEqual([]);
    expect(db.events.filter((e) => e.name === 'mappings' && e.operation === 'find')).toHaveLength(1);
  });
  it('keeps empty imports read-only and requires an actor', async () => {
    const db = database();
    expect(await importMappings(db.c, [], 'admin')).toEqual({ inserted: 0, closed: 0, skipped: 0, districtsCreated: 0, suppliersCreated: 0 });
    await expect(importMappings(db.c, [], '')).rejects.toThrow('Actor');
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
