import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

// Exercise the real backend parser while parent-owned package re-exports are being wired.
vi.mock('@anomaly/core', async () => import('../../../../../../packages/core/src/mappingImport.js'));
import { MAPPING_HEADERS } from '../../../../../../packages/core/src/mappingImport.js';
import { MAX_MAPPING_FILE_BYTES, parseMappingUpload, type MappingUpload } from './import-file';

const upload = (bytes: Uint8Array | string, name = 'mapping.csv'): MappingUpload => {
  const data = typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes);
  return { name, size: data.length, arrayBuffer: async () => Uint8Array.from(data).buffer };
};
const csv = (data = 'District One,Godown One,GDN-ONE,Supplier One,2026-01-01,,,') => `${MAPPING_HEADERS.join(',')}\r\n${data}`;
let excelJsAvailable = false;
try { createRequire(import.meta.url).resolve('exceljs'); excelJsAvailable = true; } catch { /* Parent owns dependency installation. */ }

function zip(entries: { name: string; data: Buffer; declaredSize?: number; method?: number }[]): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), compressed = deflateRawSync(entry.data);
    const localHeader = Buffer.alloc(30), centralHeader = Buffer.alloc(46);
    localHeader.writeUInt32LE(0x04034b50);
    localHeader.writeUInt16LE(entry.method ?? 8, 8);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.declaredSize ?? entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    centralHeader.writeUInt32LE(0x02014b50);
    centralHeader.writeUInt16LE(entry.method ?? 8, 10);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.declaredSize ?? entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    local.push(localHeader, name, compressed);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

describe('mapping upload CSV and limits', () => {
  it('parses real headers with BOM, CRLF, quoted commas and newlines', async () => {
    const result = await parseMappingUpload(upload('\uFEFF' + csv('"District, One",Godown One,GDN-ONE,Supplier One,2026-01-01,,"line 1\nline 2",')));
    expect(result).toEqual([{ rowNumber: 2, districtName: 'District, One', godownName: 'Godown One', portalLogin: 'GDN-ONE', supplierName: 'Supplier One', from: '2026-01-01', to: null, remarks: 'line 1\nline 2' }]);
  });
  it('rejects samples with clear row numbers and aggregates normalization failures', async () => {
    await expect(parseMappingUpload(upload(csv('EXAMPLE: delete this row,EXAMPLE godown,GDN-XXX,EXAMPLE supplier,2026-06-01,,,Notes')))).rejects.toThrow('Row 2: EXAMPLE');
    await expect(parseMappingUpload(upload(csv('District One,Godown One,GDN-ONE,Supplier One,2026-02-30,,,\nDistrict Two,,,Supplier One,2026-01-01,,,')))).rejects.toThrow(/Row 2:[\s\S]*Row 3:/);
  });
  it('ignores blank and note-only rows and accepts an empty data sheet', async () => {
    expect(await parseMappingUpload(upload(csv('\n,,,,,,,This is an instruction\n')))).toEqual([]);
  });
  it('enforces 500 data rows before any database use', async () => {
    const data = Array.from({ length: 501 }, (_, i) => `District ${i},Godown One,GDN-ONE,Supplier One,2026-01-01,,,`).join('\n');
    await expect(parseMappingUpload(upload(csv(data)))).rejects.toThrow('500');
  });
  it('rejects empty, unsupported and oversized uploads before reading them', async () => {
    const read = vi.fn(async () => new ArrayBuffer(0));
    await expect(parseMappingUpload({ name: 'mapping.csv', size: 0, arrayBuffer: read })).rejects.toThrow('non-empty');
    await expect(parseMappingUpload({ name: 'mapping.xls', size: 10, arrayBuffer: read })).rejects.toThrow('.csv or .xlsx');
    await expect(parseMappingUpload({ name: 'mapping.xlsx', size: MAX_MAPPING_FILE_BYTES + 1, arrayBuffer: read })).rejects.toThrow('2 MB');
    expect(read).not.toHaveBeenCalled();
  });
  it('checks actual byte length and rejects invalid UTF-8', async () => {
    const file = upload(csv());
    await expect(parseMappingUpload({ ...file, size: file.size - 1 })).rejects.toThrow('size');
    await expect(parseMappingUpload(upload(Buffer.from([0xff, 0xfe])))).rejects.toThrow('UTF-8');
  });
});

describe('XLSX pre-decompression safety', () => {
  it('rejects malformed archives', async () => {
    await expect(parseMappingUpload(upload('not a zip', 'mapping.xlsx'))).rejects.toThrow('archive');
  });
  it('rejects an entry whose advertised uncompressed size exceeds the bound', async () => {
    const bytes = zip([{ name: 'xl/workbook.xml', data: Buffer.from('<xml/>'), declaredSize: 4 * 1024 * 1024 + 1 }]);
    await expect(parseMappingUpload(upload(bytes, 'mapping.xlsx'))).rejects.toThrow('safety limits');
  });
  it('bounds actual inflation even when a small ZIP lies about expanded sizes', async () => {
    const bytes = zip([{ name: 'xl/workbook.xml', data: Buffer.alloc(4 * 1024 * 1024 + 1, 'a'), declaredSize: 10 }]);
    expect(bytes.length).toBeLessThan(MAX_MAPPING_FILE_BYTES);
    await expect(parseMappingUpload(upload(bytes, 'mapping.xlsx'))).rejects.toThrow('safety limits');
  });
  it('bounds total expansion, not just each entry', async () => {
    const bytes = zip(Array.from({ length: 5 }, (_, i) => ({ name: i ? `xl/shared-${i}.xml` : 'xl/workbook.xml', data: Buffer.alloc(4 * 1024 * 1024, ' ') })));
    await expect(parseMappingUpload(upload(bytes, 'mapping.xlsx'))).rejects.toThrow('expanded-size');
  });
  it('rejects too many worksheet rows before ExcelJS loads any worksheet', async () => {
    const bytes = zip([{ name: 'xl/workbook.xml', data: Buffer.from('<xml/>') }, { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(`<worksheet>${'<row/>'.repeat(2001)}</worksheet>`) }]);
    await expect(parseMappingUpload(upload(bytes, 'mapping.xlsx'))).rejects.toThrow('worksheet exceeds safety limits');
  });
  it('rejects sparse row and column addresses before workbook allocation', async () => {
    for (const xml of ['<worksheet><row r="1000000000"/></worksheet>', '<worksheet><row r="1"><c r="XFD1"/></row></worksheet>', '<worksheet><row r="1"><c r="A1000000000"/></row></worksheet>']) {
      const bytes = zip([{ name: 'xl/workbook.xml', data: Buffer.from('<xml/>') }, { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(xml) }]);
      await expect(parseMappingUpload(upload(bytes, 'mapping.xlsx'))).rejects.toThrow('address exceeds safety limits');
    }
  });
  it('rejects duplicate names, directory traversal, unsupported compression and XML entities', async () => {
    for (const entries of [
      [{ name: 'xl/workbook.xml', data: Buffer.from('x') }, { name: 'xl/workbook.xml', data: Buffer.from('y') }],
      [{ name: '../xl/workbook.xml', data: Buffer.from('x') }],
      [{ name: 'xl/workbook.xml', data: Buffer.from('x'), method: 99 }],
      [{ name: 'xl/workbook.xml', data: Buffer.from('<!DOCTYPE x [<!ENTITY bomb "x">]>') }],
    ]) await expect(parseMappingUpload(upload(zip(entries), 'mapping.xlsx'))).rejects.toThrow();
  });
});

describe.skipIf(!excelJsAvailable)('XLSX real workbooks (requires parent-installed exceljs)', () => {
  async function workbookBytes(configure?: (sheet: import('exceljs').Worksheet, workbook: import('exceljs').Workbook) => void) {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.default.Workbook();
    const sheet = workbook.addWorksheet('1 Mapping');
    sheet.addRow([...MAPPING_HEADERS]);
    sheet.addRow(['District One', 'Godown One', 'GDN-ONE', 'Supplier One', '2026-01-01', '', 'Contract', '']);
    configure?.(sheet, workbook);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  it('parses a generated workbook and preserves string values, Excel dates and plain rich text', async () => {
    const bytes = await workbookBytes((sheet, workbook) => {
      sheet.getCell('A2').value = { richText: [{ text: 'District ' }, { text: 'One', font: { bold: true } }] };
      sheet.getCell('C2').value = 'GDN-001';
      sheet.getCell('E2').value = new Date('2026-01-01T00:00:00Z');
      sheet.getCell('G2').value = 'Line 1\nLine 2';
      workbook.addWorksheet('2 Operators').getCell('A1').value = 'Ignored synthetic sheet';
    });
    expect(await parseMappingUpload(upload(bytes, 'mapping.XLSX'))).toEqual([{ rowNumber: 2, districtName: 'District One', godownName: 'Godown One', portalLogin: 'GDN-001', supplierName: 'Supplier One', from: '2026-01-01', to: null, remarks: 'Line 1\nLine 2' }]);
  });
  it('reads the provided template and rejects its actual EXAMPLE row', async () => {
    const bytes = await readFile(new URL('../../../../../../docs/templates/client-data-template.xlsx', import.meta.url));
    await expect(parseMappingUpload(upload(bytes, 'client-data-template.xlsx'))).rejects.toThrow('Row 2: EXAMPLE');
  });
  it('rejects workbooks without the exact 1 Mapping sheet', async () => {
    const bytes = await workbookBytes((sheet) => { sheet.name = '2 Operators'; });
    await expect(parseMappingUpload(upload(bytes, 'mapping.xlsx'))).rejects.toThrow('sheet named exactly "1 Mapping"');
  });
  it.each(['formula', 'hyperlink', 'error'] as const)('rejects %s cells instead of trusting cached text', async (kind) => {
    const bytes = await workbookBytes((sheet) => {
      if (kind === 'formula') sheet.getCell('E2').value = { formula: 'DATE(2026,1,1)', result: '2026-01-01' };
      if (kind === 'hyperlink') sheet.getCell('B2').value = { text: 'Godown One', hyperlink: 'https://invalid.example/not-fetched' };
      if (kind === 'error') sheet.getCell('G2').value = { error: '#VALUE!' };
    });
    await expect(parseMappingUpload(upload(bytes, 'mapping.xlsx'))).rejects.toThrow(/Cell [BEG]2: formulas, hyperlinks/);
  });
  it('applies the 500 data-row limit to XLSX too', async () => {
    const bytes = await workbookBytes((sheet) => {
      for (let i = 1; i <= 500; i++) sheet.addRow([`District ${i}`, 'Godown One', 'GDN-ONE', 'Supplier One', '2026-01-01', '', '', '']);
    });
    await expect(parseMappingUpload(upload(bytes, 'mapping.xlsx'))).rejects.toThrow('500');
  });
});
