import { describe, expect, it } from 'vitest';
import { parseContactsUpload, rowsToContacts } from './contacts-file';

const file = (name: string, content: string | Buffer) => { const b = Buffer.from(content); return { name, size: b.length, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }; };

describe('reading a contacts sheet', () => {
  it('finds the columns by name, in any order and spelling', () => {
    const rows = rowsToContacts([['Full Name', 'Mobile Number', 'E-mail', 'Labels'], ['Ravi', '9876543210', 'r@x.com', 'a,b'], ['', '', '', ''], ['Sita', '9123456780', '', '']]);
    expect(rows).toEqual([{ phone: '9876543210', name: 'Ravi', email: 'r@x.com', tags: 'a,b', notes: '' }, { phone: '9123456780', name: 'Sita', email: '', tags: '', notes: '' }]);
  });
  it('without a header, takes phone, name, email, tags, notes in that order', () => {
    expect(rowsToContacts([['9876543210', 'Ravi']])).toEqual([{ phone: '9876543210', name: 'Ravi', email: '', tags: '', notes: '' }]);
  });
  it('asks for a phone column when the first row is clearly a header without one', () => {
    expect(() => rowsToContacts([['Name', 'City'], ['Ravi', 'Hyd']])).toThrow(/phone/);
    expect(() => rowsToContacts([['', '']])).toThrow(/no rows/);
  });
  it('reads a CSV, including quotes and a byte-order mark', async () => {
    const csv = '﻿phone,name,notes\r\n9876543210,"Rao, Ravi","said ""hi"""\r\n';
    expect(await parseContactsUpload(file('c.csv', csv))).toEqual([{ phone: '9876543210', name: 'Rao, Ravi', email: '', tags: '', notes: 'said "hi"' }]);
  });
  it('reads an .xlsx workbook (first sheet), as text', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['Phone', 'Name', 'Tags']); ws.addRow([9876543210, 'Ravi', 'hostel']); ws.addRow(['+91 91234 56780', 'Sita', '']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    expect(await parseContactsUpload(file('c.xlsx', buf))).toEqual([{ phone: '9876543210', name: 'Ravi', email: '', tags: 'hostel', notes: '' }, { phone: '+91 91234 56780', name: 'Sita', email: '', tags: '', notes: '' }]);
  });
  it('refuses spreadsheets with formulas, wrong types, empty and oversized files', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S'); ws.addRow(['phone']); ws.addRow([{ formula: '1+1' }]);
    await expect(parseContactsUpload(file('bad.xlsx', Buffer.from(await wb.xlsx.writeBuffer())))).rejects.toThrow(/formulas/);
    await expect(parseContactsUpload(file('c.txt', 'x'))).rejects.toThrow(/\.csv or \.xlsx/);
    await expect(parseContactsUpload(file('c.csv', ''))).rejects.toThrow(/non-empty/);
    await expect(parseContactsUpload({ name: 'big.csv', size: 3_000_000, arrayBuffer: async () => new ArrayBuffer(0) })).rejects.toThrow(/2 MB/);
    await expect(parseContactsUpload(file('latin.csv', Buffer.from([0x70, 0x68, 0x6f, 0x6e, 0x65, 0x0a, 0xe9])))).rejects.toThrow(/UTF-8/);
  });
});
