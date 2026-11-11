import { parseMappingCsv, type ImportRow } from '@anomaly/core';
import { cellText, checkXlsxArchive } from '@/app/(app)/master/import-file';

export const MAX_CONTACT_FILE_BYTES = 2 * 1024 * 1024;
export interface Upload { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }

const ALIASES: Record<keyof ImportRow, string[]> = {
  phone: ['phone', 'mobile', 'number', 'whatsapp', 'phonenumber', 'mobilenumber', 'contact', 'contactnumber', 'whatsappnumber'],
  name: ['name', 'fullname', 'contactname', 'customername'],
  email: ['email', 'emailid', 'mail', 'emailaddress'],
  tags: ['tags', 'tag', 'labels', 'label', 'groups'],
  notes: ['notes', 'note', 'remarks', 'comment', 'comments'],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Rows of text -> contact rows. The first row is the header when it names a phone column; otherwise columns are phone, name, email, tags, notes. */
export function rowsToContacts(table: string[][]): ImportRow[] {
  const rows = table.filter((r) => r.some((c) => c.trim() !== ''));
  if (!rows.length) throw new Error('The file has no rows.');
  const head = rows[0]!.map(norm);
  const col = (k: keyof ImportRow) => head.findIndex((h) => ALIASES[k].includes(h));
  if (col('phone') >= 0) {
    const idx = { phone: col('phone'), name: col('name'), email: col('email'), tags: col('tags'), notes: col('notes') };
    return rows.slice(1).map((r) => ({ phone: r[idx.phone] ?? '', name: idx.name >= 0 ? r[idx.name] : '', email: idx.email >= 0 ? r[idx.email] : '', tags: idx.tags >= 0 ? r[idx.tags] : '', notes: idx.notes >= 0 ? r[idx.notes] : '' }));
  }
  if ((rows[0]![0] ?? '').replace(/[^0-9]/g, '').length < 8) throw new Error('The first row should name the columns. A column called "phone" is required (name, email, tags and notes are optional).');
  return rows.map((r) => ({ phone: r[0] ?? '', name: r[1] ?? '', email: r[2] ?? '', tags: r[3] ?? '', notes: r[4] ?? '' }));
}

export async function parseContactsUpload(file: Upload): Promise<ImportRow[]> {
  if (file.size <= 0) throw new Error('Choose a non-empty .csv or .xlsx file.');
  if (file.size > MAX_CONTACT_FILE_BYTES) throw new Error('Files must be 2 MB or smaller.');
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext !== 'csv' && ext !== 'xlsx') throw new Error('Choose a .csv or .xlsx file.');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new Error('The file could not be read completely. Try again.');
  if (ext === 'csv') {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('The CSV must be saved as UTF-8. Export it as "CSV UTF-8" and try again.'); }
    return rowsToContacts(parseMappingCsv(text));
  }
  checkXlsxArchive(bytes);
  let workbook: import('exceljs').Workbook;
  try {
    const ExcelJS = await import('exceljs');
    workbook = new ExcelJS.default.Workbook();
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch { throw new Error('Could not read the workbook. Save a fresh .xlsx copy and try again.'); }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('The workbook has no sheet.');
  if (sheet.columnCount > 32) throw new Error('Too many columns. Keep only phone, name, email, tags and notes.');
  const table: string[][] = [];
  for (let i = 1; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i); const vals: string[] = [];
    for (let c = 1; c <= Math.max(sheet.columnCount, 1); c++) { const cell = row.getCell(c); vals.push(cellText(cell.value, cell.address)); }
    table.push(vals);
  }
  return rowsToContacts(table);
}
