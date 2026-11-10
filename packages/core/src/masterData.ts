import type { ClientSession, Collection } from 'mongodb';

export interface DistrictDoc { code: string; name: string; createdAt: Date; updatedAt: Date }
export interface GodownMasterDoc {
  godownId: number; portalLogin: string; name: string; status: 'active' | 'disabled';
  contactPerson?: string; contactPhone?: string; createdAt: Date; updatedAt: Date;
}
export interface SupplierDoc { code: string; name: string; contactPhone?: string; createdAt: Date; updatedAt: Date }
export interface HostelMasterDoc {
  godownId: number; hostelCode: string; hostelName: string; districtName: string; districtCode: string;
  hostelPhone?: string; contactPerson?: string;
  /** The hostel asked us to stop WhatsApp reminders (by replying STOP, or an administrator recorded it). */
  whatsappOptOut?: boolean; whatsappOptOutAt?: Date;
  createdAt: Date; updatedAt: Date;
}
/** ISO calendar dates, [from, to): the end date belongs to the next mapping. */
export interface MappingDoc {
  districtCode: string; godownId: number; supplierCode: string; from: string; to: string | null;
  remarks?: string; createdAt: Date; changedBy: string;
}
export interface AuditDoc { actor: string; action: string; target: string; at: Date; details?: unknown }

/** Structural contract: the parent supplies collections, unique indexes and Mongo transaction retries. */
export interface MasterDataCollections {
  districts: Collection<DistrictDoc>; godowns: Collection<GodownMasterDoc>; suppliers: Collection<SupplierDoc>;
  mappings: Collection<MappingDoc>; hostelsMaster: Collection<HostelMasterDoc>; auditLog: Collection<AuditDoc>;
  transaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T>;
}
export interface ReassignDistrictInput {
  districtCode: string; godownId: number; supplierCode: string; from: string; remarks?: string;
}
export interface HostelMappingResolution {
  hostel: HostelMasterDoc | null; district: DistrictDoc | null; godown: GodownMasterDoc | null;
  supplier: SupplierDoc | null; mapping: MappingDoc | null;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function mappingIntervalsOverlap(a: Pick<MappingDoc, 'from' | 'to'>, b: Pick<MappingDoc, 'from' | 'to'>): boolean {
  return (b.to === null || a.from < b.to) && (a.to === null || b.from < a.to);
}

/** Shared by reassignment and import, including pre-existing history. */
export function validateMappingIntervals(mappings: readonly MappingDoc[]): void {
  for (const m of mappings) {
    if (!isCalendarDate(m.from) || (m.to !== null && (!isCalendarDate(m.to) || m.to <= m.from))) {
      throw new Error(`Invalid interval for district ${m.districtCode}: [${m.from}, ${m.to ?? 'open'})`);
    }
  }
  const sorted = [...mappings].sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (a.to !== null && b.from >= a.to) break;
      if (a.districtCode === b.districtCode) throw new Error(`Overlapping mappings for district ${a.districtCode}`);
      if (a.godownId === b.godownId && a.supplierCode !== b.supplierCode) {
        throw new Error(`Godown ${a.godownId} has different suppliers during overlapping dates`);
      }
    }
  }
}

/** A strictly increasing timestamp guarantees a write even within the same millisecond.
 * All mapping writers take these document locks before interval reads; write conflicts
 * must retry the entire transaction, not just the failed statement. */
export async function lockMasterDataRecord<T extends { updatedAt: Date }>(
  collection: Collection<T>, filter: Parameters<Collection<T>['updateOne']>[0], doc: T, session: ClientSession,
): Promise<void> {
  const updatedAt = new Date(Math.max(Date.now(), doc.updatedAt.getTime() + 1));
  // The generic Mongo update type cannot infer that every T has updatedAt.
  const result = await collection.updateOne(filter, { $set: { updatedAt } } as Parameters<Collection<T>['updateOne']>[1], { session });
  if (result.matchedCount !== 1) throw new Error('Master record changed concurrently; retry the transaction');
}

export async function reassignDistrict(c: MasterDataCollections, input: ReassignDistrictInput, actor: string): Promise<MappingDoc> {
  if (!actor.trim()) throw new Error('Actor is required');
  if (!isCalendarDate(input.from)) throw new Error('Effective from must be a real YYYY-MM-DD calendar date');
  if (!input.districtCode.trim() || !input.supplierCode.trim() || !Number.isSafeInteger(input.godownId) || input.godownId <= 0) {
    throw new Error('District, supplier and a valid godown ID are required');
  }
  return c.transaction(async (session) => {
    const district = await c.districts.findOne({ code: input.districtCode }, { session });
    if (!district) throw new Error(`Unknown district ${input.districtCode}`);
    await lockMasterDataRecord(c.districts, { code: district.code }, district, session);
    const godown = await c.godowns.findOne({ godownId: input.godownId }, { session });
    if (!godown || godown.status !== 'active') throw new Error(`Unknown or disabled godown ${input.godownId}`);
    await lockMasterDataRecord(c.godowns, { godownId: godown.godownId }, godown, session);
    if (!await c.suppliers.findOne({ code: input.supplierCode }, { session })) throw new Error(`Unknown supplier ${input.supplierCode}`);
    const existing = await c.mappings.find({ $or: [{ districtCode: input.districtCode }, { godownId: input.godownId }] }, { session }).toArray();
    validateMappingIntervals(existing);
    const districtMappings = existing.filter((m) => m.districtCode === input.districtCode);
    if (districtMappings.some((m) => m.from === input.from)) {
      throw new Error('A mapping already starts on this date; history cannot be overwritten');
    }
    const previous = districtMappings.find((m) => m.from < input.from && (m.to === null || input.from < m.to));
    const next = districtMappings.filter((m) => m.from > input.from).sort((a, b) => a.from.localeCompare(b.from))[0];
    const mapping: MappingDoc = {
      districtCode: input.districtCode, godownId: input.godownId, supplierCode: input.supplierCode,
      from: input.from, to: previous ? previous.to : next?.from ?? null,
      ...(input.remarks?.trim() ? { remarks: input.remarks.trim() } : {}), createdAt: new Date(), changedBy: actor,
    };
    validateMappingIntervals([...existing.map((m) => m === previous ? { ...m, to: input.from } : m), mapping]);
    if (previous) {
      const result = await c.mappings.updateOne(
        { districtCode: previous.districtCode, from: previous.from, to: previous.to }, { $set: { to: input.from } }, { session },
      );
      if (result.matchedCount !== 1) throw new Error('Mapping changed concurrently; retry the transaction');
    }
    await c.mappings.insertOne(mapping, { session });
    await c.auditLog.insertOne({ actor, action: 'mapping.reassign', target: input.districtCode, at: new Date(), details: { previous: previous ?? null, mapping } }, { session });
    return mapping;
  });
}

/** The lookup key is portal provenance, not necessarily the historically assigned godown. Never rewrites it. */
export async function resolveHostelMapping(
  c: MasterDataCollections, key: { godownId: number; hostelCode: string }, on: string,
): Promise<HostelMappingResolution> {
  if (!isCalendarDate(on)) throw new Error('Lookup date must be a real YYYY-MM-DD calendar date');
  const hostel = await c.hostelsMaster.findOne(key);
  if (!hostel) return { hostel: null, district: null, godown: null, supplier: null, mapping: null };
  const district = await c.districts.findOne({ code: hostel.districtCode });
  const candidates = await c.mappings.find({ districtCode: hostel.districtCode, from: { $lte: on }, $or: [{ to: null }, { to: { $gt: on } }] }).toArray();
  if (candidates.length > 1) throw new Error(`Overlapping mappings for district ${hostel.districtCode}`);
  const mapping = candidates[0] ?? null;
  const godown = mapping ? await c.godowns.findOne({ godownId: mapping.godownId }) : null;
  const supplier = mapping ? await c.suppliers.findOne({ code: mapping.supplierCode }) : null;
  return { hostel, district, godown, supplier, mapping };
}
