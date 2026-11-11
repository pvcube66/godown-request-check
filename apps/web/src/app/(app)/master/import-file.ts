import { inflateRawSync } from 'node:zlib';
import { normalizeMappingRows, parseMappingCsv, type NormalizedMappingRow } from '@anomaly/core';

import { MAX_MAPPING_FILE_BYTES } from './upload-limits';
export { MAX_MAPPING_FILE_BYTES } from './upload-limits';
const MAX_EXPANDED_BYTES = 16 * 1024 * 1024;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_WORKSHEET_ROWS = 2000;
export interface MappingUpload { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }

/** ExcelJS loads ZIP contents in memory. Verify every entry with bounded inflation
 * first; trusting only ZIP-declared sizes or counting rows after load is not safe. */
export function checkXlsxArchive(bytes: Buffer): void {
  const fail = (message = 'Invalid or unsupported XLSX archive'): never => { throw new Error(message); };
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0) fail();
  const entries = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0 || bytes.readUInt16LE(end + 8) !== entries || entries === 0 || entries > 256 || directoryOffset + directorySize !== end) fail();
  let cursor = directoryOffset, expanded = 0;
  const names = new Set<string>();
  const ranges: [number, number][] = [];
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail();
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || (flags & 1) || ![0, 8].includes(method) || size > MAX_ENTRY_BYTES || local + 30 > directoryOffset || bytes.readUInt16LE(cursor + 34) !== 0) fail('XLSX archive exceeds safety limits or uses unsupported ZIP features');
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (!name || names.has(name) || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) fail();
    names.add(name);
    if (bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) fail();
    const localNameLength = bytes.readUInt16LE(local + 26), localExtraLength = bytes.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtraLength;
    const stop = start + compressedSize;
    if (stop > directoryOffset || bytes.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name) fail();
    if (!(flags & 8) && (bytes.readUInt32LE(local + 18) !== compressedSize || bytes.readUInt32LE(local + 22) !== size)) fail();
    if (ranges.some(([a, b]) => local < b && a < stop)) fail();
    ranges.push([local, stop]);
    let data: Buffer;
    try { data = method === 0 ? bytes.subarray(start, stop) : inflateRawSync(bytes.subarray(start, stop), { maxOutputLength: MAX_ENTRY_BYTES }); }
    catch { fail('XLSX archive expands beyond safety limits or is corrupt'); }
    if (data!.length !== size || (expanded += data!.length) > MAX_EXPANDED_BYTES) fail('XLSX archive exceeds expanded-size safety limits');
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      const xml = data!.toString('utf8');
      if (/<!DOCTYPE|<!ENTITY|\u0000/i.test(xml)) fail('XLSX XML declarations or non-UTF-8 XML are not supported');
      if (/^xl\/worksheets\/[^/]+\.xml$/.test(name)) {
        if ((xml.match(/<(?:\w+:)?row\b/g)?.length ?? 0) > MAX_WORKSHEET_ROWS || (xml.match(/<(?:\w+:)?c\b/g)?.length ?? 0) > 20000) fail('XLSX worksheet exceeds safety limits; use a mapping-only workbook');
        // A tiny sparse sheet can otherwise claim a billionth row/column.
        for (const match of xml.matchAll(/<(?:\w+:)?(row|c)\b[^>]*?\br\s*=\s*["']([^"']*)["']/g)) {
          const address = match[2]!;
          if (match[1] === 'row') {
            if (!/^\d+$/.test(address) || Number(address) < 1 || Number(address) > MAX_WORKSHEET_ROWS) fail('XLSX worksheet row address exceeds safety limits');
          } else {
            const cell = /^([A-Z]{1,3})(\d+)$/.exec(address);
            if (!cell || Number(cell[2]) < 1 || Number(cell[2]) > MAX_WORKSHEET_ROWS) fail('XLSX worksheet cell address exceeds safety limits');
            const column = [...cell![1]!].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
            if (column > 64) fail('XLSX worksheet column address exceeds safety limits');
          }
        }
      }
    }
    cursor = next;
  }
  if (cursor !== end || !names.has('xl/workbook.xml')) fail();
}

export function cellText(value: unknown, address: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && value !== null && 'richText' in value && Object.keys(value).every((key) => key === 'richText')) {
    const richText: unknown = value.richText;
    if (Array.isArray(richText) && richText.every((part: unknown) => typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string' && Object.keys(part).every((key) => key === 'text' || key === 'font'))) {
      return richText.map((part: { text: string }) => part.text).join('');
    }
  }
  throw new Error(`Cell ${address}: formulas, hyperlinks, errors and unsupported cell values are not allowed; paste plain values instead`);
}

export async function parseMappingUpload(file: MappingUpload): Promise<NormalizedMappingRow[]> {
  if (file.size <= 0) throw new Error('Choose a non-empty CSV or XLSX mapping file');
  if (file.size > MAX_MAPPING_FILE_BYTES) throw new Error('Mapping files must be 2 MB or smaller');
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension !== 'csv' && extension !== 'xlsx') throw new Error('Choose a .csv or .xlsx file, not an operator or contacts sheet');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.length > MAX_MAPPING_FILE_BYTES) throw new Error('Invalid mapping file size; maximum 2 MB');
  if (extension === 'csv') {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('CSV must use UTF-8 encoding; export it as CSV UTF-8 and try again'); }
    return normalizeMappingRows(parseMappingCsv(text));
  }
  checkXlsxArchive(bytes);
  let workbook: import('exceljs').Workbook;
  try {
    const ExcelJS = await import('exceljs');
    workbook = new ExcelJS.default.Workbook();
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch { throw new Error('Could not read the XLSX workbook; save a fresh .xlsx copy or ask an administrator to check the workbook parser installation'); }
  const sheet = workbook.getWorksheet('1 Mapping');
  if (!sheet) throw new Error('The workbook must contain a sheet named exactly "1 Mapping"; operator and contacts sheets are not imported');
  if (sheet.rowCount > MAX_WORKSHEET_ROWS || sheet.columnCount > 32) throw new Error('Mapping worksheet exceeds safety limits; remove unused rows and columns');
  const rows: string[][] = [];
  for (let index = 1; index <= sheet.rowCount; index++) {
    const source = sheet.getRow(index);
    const values: string[] = [];
    for (let col = 1; col <= sheet.columnCount; col++) {
      const cell = source.getCell(col);
      values.push(cellText(cell.value, cell.address));
    }
    rows.push(values);
  }
  return normalizeMappingRows(rows);
}
