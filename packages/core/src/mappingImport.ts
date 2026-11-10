import { createHash } from 'node:crypto';
import type { DistrictDoc, MappingDoc, MasterDataCollections, SupplierDoc } from './masterData.js';
import { isCalendarDate, lockMasterDataRecord, validateMappingIntervals } from './masterData.js';

export const MAPPING_HEADERS = [
  'District (as on portal)', 'Godown name', 'Godown portal login (e.g. GDN-XXX)', 'Supplier name',
  'Effective from (YYYY-MM-DD)', 'Effective to (blank = still current)', 'Remarks', 'Notes',
] as const;
export interface NormalizedMappingRow {
  rowNumber: number; districtName: string; godownName: string; portalLogin: string; supplierName: string;
  from: string; to: string | null; remarks?: string; notes?: string;
}
export interface ImportMappingsResult { inserted: number; closed: number; skipped: number; districtsCreated: number; suppliersCreated: number }
export class MappingValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('\n'));
    this.name = 'MappingValidationError';
  }
}
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
const identity = (s: string) => clean(s.normalize('NFKC')).toLowerCase();
const headerKey = (s: string) => identity(s.replace(/^\uFEFF/, '')).replace(/[_-]+/g, ' ');
const aliases = [
  ['district', 'district name'], ['godown', 'godown name'], ['portal login', 'godown portal login', 'godown login'],
  ['supplier', 'supplier name'], ['effective from', 'from', 'start date'], ['effective to', 'to', 'end date'], ['remarks', 'remark'], ['notes', 'note'],
];

/** RFC-style quoted fields, including embedded newlines; malformed quotes are rejected. */
export function parseMappingCsv(text: string): string[][] {
  text = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false, line = 1;
  const finishField = () => { row.push(field); field = ''; closed = false; };
  const finishRow = () => { finishField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else {
        if (ch === '\n') line++;
        if (ch === '\r' && text[i + 1] === '\n') { field += '\n'; i++; line++; }
        else field += ch;
      }
    } else if (ch === ',') finishField();
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      finishRow(); line++;
    } else if (ch === '"' && field === '' && !closed) quoted = true;
    else if (closed || ch === '"') throw new MappingValidationError([`CSV line ${line}: unexpected character or quote after a field`]);
    else field += ch;
  }
  if (quoted) throw new MappingValidationError([`CSV line ${line}: unterminated quoted field`]);
  if (field !== '' || row.length > 0 || closed) finishRow();
  return rows;
}

export function normalizeMappingRows(rows: string[][]): NormalizedMappingRow[] {
  const headerIndex = rows.findIndex((r) => r.some((v) => v.trim() !== ''));
  if (headerIndex < 0) throw new MappingValidationError(['Mapping file is empty; headers are required']);
  const headers = rows[headerIndex]!;
  const errors: string[] = [];
  const columns = MAPPING_HEADERS.map((h, i) => {
    const matches = headers.flatMap((v, index) => headerKey(v) === headerKey(h) || aliases[i]!.includes(headerKey(v)) ? [index] : []);
    if (matches.length > 1) errors.push(`Header row: duplicate ${h} column`);
    // Remarks and Notes are optional in hand-authored CSV files.
    if (matches.length === 0 && i < 6) errors.push(`Header row: missing ${h} column`);
    return matches[0] ?? -1;
  });
  if (errors.length) throw new MappingValidationError(errors);
  const result: NormalizedMappingRow[] = [];
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const source = rows[index]!;
    const values = columns.map((c) => c < 0 ? '' : source[c]?.trim() ?? '');
    const [districtName = '', godownName = '', portalLogin = '', supplierName = '', from = '', to = '', remarks = '', notes = ''] = values;
    if (source.some((v) => /\bEXAMPLE\b/i.test(v))) {
      errors.push(`Row ${index + 1}: EXAMPLE template row must be deleted or replaced`);
      continue;
    }
    if (values.every((v, i) => i === 7 || v === '')) continue;
    if (source.some((v, i) => v.trim() && !columns.includes(i))) errors.push(`Row ${index + 1}: data in an unrecognized column`);
    result.push({ rowNumber: index + 1, districtName: clean(districtName), godownName: clean(godownName), portalLogin: clean(portalLogin), supplierName: clean(supplierName), from, to: to || null, ...(remarks ? { remarks } : {}), ...(notes ? { notes } : {}) });
  }
  errors.push(...rowErrors(result));
  if (errors.length) throw new MappingValidationError(errors);
  return result;
}

function rowErrors(rows: readonly NormalizedMappingRow[]): string[] {
  const errors: string[] = [];
  if (rows.length > 500) return ['Mapping import is limited to 500 rows'];
  for (const r of rows) {
    const prefix = `Row ${r.rowNumber}: `;
    if ([r.districtName, r.godownName, r.portalLogin, r.supplierName, r.remarks ?? '', r.notes ?? ''].some((v) => /\bEXAMPLE\b/i.test(v))) errors.push(prefix + 'EXAMPLE template row must be deleted or replaced');
    if (![r.districtName, r.godownName, r.portalLogin, r.supplierName].every((v) => clean(v))) errors.push(prefix + 'district, godown name, portal login and supplier are required');
    if (!isCalendarDate(r.from)) errors.push(prefix + 'Effective from must be a real YYYY-MM-DD calendar date');
    if (r.to !== null && !isCalendarDate(r.to)) errors.push(prefix + 'Effective to must be blank or a real YYYY-MM-DD calendar date');
    if (r.to !== null && r.to <= r.from) errors.push(prefix + 'Effective to is end-exclusive and must be after Effective from');
  }
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]!;
    for (const b of rows.slice(i + 1)) {
      const overlap = (b.to === null || a.from < b.to) && (a.to === null || b.from < a.to);
      if (identity(a.districtName) === identity(b.districtName) && (a.from === b.from || overlap)) {
        errors.push(`Rows ${a.rowNumber}, ${b.rowNumber}: duplicate or overlapping district intervals`);
      }
      if (identity(a.portalLogin) === identity(b.portalLogin) && identity(a.godownName) === identity(b.godownName) && identity(a.supplierName) !== identity(b.supplierName) && overlap) {
        errors.push(`Rows ${a.rowNumber}, ${b.rowNumber}: godown has different suppliers during overlapping dates`);
      }
    }
  }
  return errors;
}

const codeFor = (kind: 'district' | 'supplier', name: string) => `${kind === 'district' ? 'D' : 'S'}-${createHash('sha256').update(identity(name)).digest('hex').slice(0, 24)}`;
const keyFor = (m: Pick<MappingDoc, 'districtCode' | 'from'>) => JSON.stringify([m.districtCode, m.from]);
class UnchangedImport extends Error {
  constructor(readonly result: ImportMappingsResult) { super('Unchanged import'); }
}

/** All validation and changes run in one retryable transaction. An exact repeat aborts
 * the lock-only transaction so even master updatedAt timestamps stay unchanged. */
export async function importMappings(c: MasterDataCollections, rows: readonly NormalizedMappingRow[], actor: string): Promise<ImportMappingsResult> {
  if (!actor.trim()) throw new MappingValidationError(['Actor is required']);
  const errors = rowErrors(rows);
  if (errors.length) throw new MappingValidationError(errors);
  const empty: ImportMappingsResult = { inserted: 0, closed: 0, skipped: 0, districtsCreated: 0, suppliersCreated: 0 };
  if (!rows.length) return empty;
  try {
    return await c.transaction(async (session) => {
      const errors: string[] = [];
      const godowns = await c.godowns.find({}, { session }).toArray();
      const districts = await c.districts.find({}, { session }).toArray();
      const suppliers = await c.suppliers.find({}, { session }).toArray();
      const now = new Date();
      const newDistricts = new Map<string, DistrictDoc>();
      const newSuppliers = new Map<string, SupplierDoc>();
      const incoming: { row: NormalizedMappingRow; mapping: MappingDoc }[] = [];
      const named = <T extends { code: string; name: string }>(all: readonly T[], name: string, rowNumber: number, kind: string): T | undefined => {
        const matches = all.filter((d) => identity(d.name) === identity(name));
        if (matches.length > 1) errors.push(`Row ${rowNumber}: ambiguous ${kind} name ${name}`);
        return matches[0];
      };
      for (const row of rows) {
        const matches = godowns.filter((g) => identity(g.portalLogin) === identity(row.portalLogin) && identity(g.name) === identity(row.godownName));
        if (matches.length !== 1 || matches[0]!.status !== 'active' || !Number.isSafeInteger(matches[0]!.godownId) || matches[0]!.godownId <= 0) {
          errors.push(`Row ${row.rowNumber}: godown login + name must resolve to exactly one active portal godown`);
          continue;
        }
        const district = named(districts, row.districtName, row.rowNumber, 'district') ?? newDistricts.get(identity(row.districtName)) ?? { code: codeFor('district', row.districtName), name: clean(row.districtName), createdAt: now, updatedAt: now };
        const supplier = named(suppliers, row.supplierName, row.rowNumber, 'supplier') ?? newSuppliers.get(identity(row.supplierName)) ?? { code: codeFor('supplier', row.supplierName), name: clean(row.supplierName), createdAt: now, updatedAt: now };
        if (districts.some((d) => d.code === district.code && identity(d.name) !== identity(row.districtName))) errors.push(`Row ${row.rowNumber}: district code collision`);
        if (suppliers.some((s) => s.code === supplier.code && identity(s.name) !== identity(row.supplierName))) errors.push(`Row ${row.rowNumber}: supplier code collision`);
        if (!districts.some((d) => d.code === district.code)) newDistricts.set(identity(row.districtName), district);
        if (!suppliers.some((s) => s.code === supplier.code)) newSuppliers.set(identity(row.supplierName), supplier);
        incoming.push({ row, mapping: { districtCode: district.code, godownId: matches[0]!.godownId, supplierCode: supplier.code, from: row.from, to: row.to, ...(row.remarks ? { remarks: row.remarks } : {}), createdAt: now, changedBy: actor } });
      }
      if (errors.length) throw new MappingValidationError(errors);
      for (const district of [...newDistricts.values()].sort((a, b) => a.code.localeCompare(b.code))) {
        await c.districts.updateOne({ code: district.code }, { $setOnInsert: district }, { upsert: true, session });
      }
      const districtCodes = [...new Set(incoming.map(({ mapping: m }) => m.districtCode))].sort();
      for (const code of districtCodes) {
        const district = await c.districts.findOne({ code }, { session });
        if (!district) throw new Error(`District ${code} disappeared during import`);
        await lockMasterDataRecord(c.districts, { code }, district, session);
      }
      const godownIds = [...new Set(incoming.map(({ mapping: m }) => m.godownId))].sort((a, b) => a - b);
      for (const godownId of godownIds) {
        const godown = godowns.find((g) => g.godownId === godownId)!;
        await lockMasterDataRecord(c.godowns, { godownId }, godown, session);
      }
      const existing = await c.mappings.find({ $or: [{ districtCode: { $in: districtCodes } }, { godownId: { $in: godownIds } }] }, { session }).toArray();
      const planned = new Map<string, MappingDoc>(existing.map((m) => [keyFor(m), m]));
      if (planned.size !== existing.length) throw new MappingValidationError(['Database contains duplicate district/from mappings']);
      const inserts: MappingDoc[] = [], closes: { previous: MappingDoc; to: string }[] = [];
      let skipped = 0;
      for (const { row, mapping: m } of incoming) {
        const prior = planned.get(keyFor(m));
        if (!prior) { inserts.push(m); planned.set(keyFor(m), m); continue; }
        if (prior.godownId !== m.godownId || prior.supplierCode !== m.supplierCode || (prior.remarks ?? '') !== (m.remarks ?? '')) {
          errors.push(`Row ${row.rowNumber}: existing history cannot change godown, supplier or remarks`);
        } else if (prior.to === m.to) skipped++;
        else if (prior.to === null && m.to !== null && incoming.some(({ mapping: next }) => next.districtCode === m.districtCode && next.from === m.to)) {
          closes.push({ previous: prior, to: m.to });
          planned.set(keyFor(m), { ...prior, to: m.to });
        } else errors.push(`Row ${row.rowNumber}: history cannot be overwritten; an open interval may only close at an adjacent imported mapping's start`);
      }
      try { validateMappingIntervals([...planned.values()]); }
      catch (e) { errors.push(`Rows ${rows.map((r) => r.rowNumber).join(', ')}: ${(e as Error).message}`); }
      if (errors.length) throw new MappingValidationError(errors);
      const result = { inserted: inserts.length, closed: closes.length, skipped, districtsCreated: newDistricts.size, suppliersCreated: newSuppliers.size };
      if (!inserts.length && !closes.length) throw new UnchangedImport(result);
      for (const supplier of newSuppliers.values()) {
        await c.suppliers.updateOne({ code: supplier.code }, { $setOnInsert: supplier }, { upsert: true, session });
      }
      for (const { previous, to } of closes) {
        const result = await c.mappings.updateOne({ districtCode: previous.districtCode, from: previous.from, to: null }, { $set: { to } }, { session });
        if (result.matchedCount !== 1) throw new Error('Mapping changed concurrently; retry the transaction');
      }
      for (const mapping of inserts) await c.mappings.insertOne(mapping, { session });
      await c.auditLog.insertOne({ actor, action: 'mapping.import', target: 'mappings', at: now, details: { ...result, inserted: inserts, closed: closes } }, { session });
      return result;
    });
  } catch (e) {
    if (e instanceof UnchangedImport) return e.result;
    throw e;
  }
}
