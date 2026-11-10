'use server';

import { revalidatePath } from 'next/cache';
import { importMappings, reassignDistrict, seedMasterData, updateItemMaster, MappingValidationError, isCalendarDate } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { lockMasterAdmin, masterAdminAccess, requireMasterAdmin, unlockMasterAdmin } from '@/lib/master-auth';
import type { MasterActionState } from './action-state';
import { parseMappingUpload } from './import-file';
import { godownIdField, MasterInputError, phoneField, textField } from './validation';

function refreshMasterPages() {
  for (const path of ['/master', '/', '/orders', '/search', '/accounts']) revalidatePath(path);
  revalidatePath('/hostel/[code]', 'page');
}

async function mutate(task: (c: Awaited<ReturnType<typeof getDb>>, actor: string) => Promise<string>): Promise<MasterActionState> {
  try {
    const { actor } = await requireMasterAdmin();
    const success = await task(await getDb(), actor);
    refreshMasterPages();
    return { success };
  } catch (error) {
    if (error instanceof MasterInputError || error instanceof MappingValidationError) return { error: error.message };
    return { error: 'Could not save this change. Check that master admin access is still unlocked, then try again. No portal changes are made.' };
  }
}

export async function unlockAction(_state: MasterActionState, form: FormData): Promise<MasterActionState> {
  try {
    const access = await masterAdminAccess();
    if (!access.configured) return { error: 'Set a separate MASTER_ADMIN_PASSWORD on the server before unlocking master data.' };
    const raw = form.get('password');
    if (typeof raw !== 'string' || !raw || raw.length > 1024 || !await unlockMasterAdmin(raw)) return { error: 'Master admin password was not accepted. Use the separate master admin password, not the dashboard password.' };
    revalidatePath('/master');
    return { success: 'Master data unlocked for this temporary admin session.' };
  } catch { return { error: 'Could not unlock master data. Check the server configuration and try again.' }; }
}

export async function lockAction(_state: MasterActionState, _form: FormData): Promise<MasterActionState> {
  try {
    await requireMasterAdmin();
    await lockMasterAdmin();
    revalidatePath('/master');
    return { success: 'Master data locked.' };
  } catch { return { error: 'Could not lock this session. Refresh the page and try again.' }; }
}

export async function bootstrapAction(_state: MasterActionState, _form: FormData): Promise<MasterActionState> {
  return mutate(async (c, actor) => {
    const result = await seedMasterData(c, actor);
    return `Stored data bootstrapped: ${result.godowns} godowns, ${result.hostels} hostels, ${result.districts} districts. No portal calls were made.`;
  });
}

export async function importAction(_state: MasterActionState, form: FormData): Promise<MasterActionState> {
  return mutate(async (c, actor) => {
    const file = form.get('mappingFile');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') throw new MasterInputError('Choose a CSV or XLSX mapping file');
    let rows;
    try { rows = await parseMappingUpload(file); }
    catch (error) { throw new MasterInputError(error instanceof Error ? error.message : 'Could not read the mapping file'); }
    const result = await importMappings(c, rows, actor);
    return `Mapping import complete: ${result.inserted} inserted, ${result.closed} closed, ${result.skipped} skipped.`;
  });
}

export async function reassignAction(_state: MasterActionState, form: FormData): Promise<MasterActionState> {
  return mutate(async (c, actor) => {
    const from = textField(form, 'from', 10, true);
    if (!isCalendarDate(from)) throw new MasterInputError('From [inclusive] must be a real YYYY-MM-DD date');
    try {
      const result = await reassignDistrict(c, {
        districtCode: textField(form, 'districtCode', 100, true), godownId: godownIdField(form),
        supplierCode: textField(form, 'supplierCode', 100, true), from,
        remarks: textField(form, 'remarks', 1000),
      }, actor);
      return `District reassigned from ${result.from} [inclusive] to ${result.to ?? 'open-ended'}${result.to ? ' [exclusive]' : ''}. Existing history was retained.`;
    } catch (error) {
      if (error instanceof Error && /^(Unknown|Overlapping|Godown \d+ has|A mapping already starts|Invalid interval|Effective from|District, supplier)/.test(error.message)) throw new MasterInputError(error.message);
      throw error;
    }
  });
}

export async function itemCorrectionAction(_state: MasterActionState, form: FormData): Promise<MasterActionState> {
  return mutate(async (c, actor) => {
    const key = textField(form, 'key', 2048, true);
    const patch = { unit: textField(form, 'unit', 100), packSize: textField(form, 'packSize', 100), brand: textField(form, 'brand', 100), category: textField(form, 'category', 100) };
    await updateItemMaster(c, key, patch, actor);
    return 'Item correction saved. Observed identity and historical order snapshots were not changed.';
  });
}

export async function godownContactAction(_state: MasterActionState, form: FormData): Promise<MasterActionState> {
  return mutate(async (c, actor) => {
    const godownId = godownIdField(form);
    const contactPerson = textField(form, 'contactPerson', 100);
    const contactPhone = phoneField(form, 'contactPhone');
    return c.transaction(async (session) => {
      const previous = await c.godowns.findOne({ godownId }, { session });
      if (!previous) throw new MasterInputError('Godown not found. Bootstrap stored data or refresh the catalog.');
      if ((previous.contactPerson ?? '') === contactPerson && (previous.contactPhone ?? '') === contactPhone) return 'Godown contact is unchanged.';
      const updatedAt = new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1));
      const set = { updatedAt, ...(contactPerson ? { contactPerson } : {}), ...(contactPhone ? { contactPhone } : {}) };
      const unset = { ...(!contactPerson ? { contactPerson: '' as const } : {}), ...(!contactPhone ? { contactPhone: '' as const } : {}) };
      const result = await c.godowns.updateOne({ godownId }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { session });
      if (result.matchedCount !== 1) throw new Error('Godown contact changed concurrently');
      await c.auditLog.insertOne({ actor, action: 'contact.godown.update', target: `godown:${godownId}`, at: new Date(), details: { before: { contactPerson: previous.contactPerson ?? '', contactPhone: previous.contactPhone ?? '' }, after: { contactPerson, contactPhone } } }, { session });
      return 'Godown contact saved.';
    });
  });
}

export async function hostelContactAction(_state: MasterActionState, form: FormData): Promise<MasterActionState> {
  return mutate(async (c, actor) => {
    const key = { godownId: godownIdField(form), hostelCode: textField(form, 'hostelCode', 100, true) };
    const hostelPhone = phoneField(form, 'hostelPhone');
    return c.transaction(async (session) => {
      const previous = await c.hostelsMaster.findOne(key, { session });
      if (!previous) throw new MasterInputError('Hostel not found. Bootstrap stored data or refresh the catalog.');
      if ((previous.hostelPhone ?? '') === hostelPhone) return 'Hostel phone is unchanged.';
      const updatedAt = new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1));
      const result = await c.hostelsMaster.updateOne(key, hostelPhone ? { $set: { hostelPhone, updatedAt } } : { $set: { updatedAt }, $unset: { hostelPhone: '' } }, { session });
      if (result.matchedCount !== 1) throw new Error('Hostel contact changed concurrently');
      await c.auditLog.insertOne({ actor, action: 'contact.hostel.update', target: `hostel:${key.godownId}:${key.hostelCode}`, at: new Date(), details: { before: { hostelPhone: previous.hostelPhone ?? '' }, after: { hostelPhone } } }, { session });
      return 'Hostel phone saved. District and portal godown provenance were not changed.';
    });
  });
}
