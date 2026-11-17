import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { xlsxResponse } from './xlsx';

const read = async (r: Response) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as never); return wb; };

describe('Excel download', () => {
  it('is a real xlsx with a data sheet and a Filters sheet', async () => {
    const r = await xlsxResponse('t.xlsx', { name: 'Data', head: ['A', 'B'], rows: [[1, 'x'], [2, new Date('2026-11-01T00:00:00Z')]] }, [['Month', 'November 2026'], ['Godown', '']]);
    expect(r.headers.get('Content-Type')).toContain('spreadsheetml');
    const wb = await read(r);
    expect(wb.getWorksheet('Data')!.rowCount).toBe(3);
    const f = wb.getWorksheet('Filters')!;
    expect(f.getRow(2).getCell(2).value).toBe('November 2026');
    expect(f.getRow(3).getCell(2).value).toBe('All');
    expect(f.getRow(4).getCell(2).value).toBe(2);
  });
  it('cannot be tricked into running a formula typed by a person', async () => {
    const wb = await read(await xlsxResponse('t.xlsx', { name: 'Data', head: ['A'], rows: [['=HYPERLINK("x")']] }, []));
    expect(wb.getWorksheet('Data')!.getRow(2).getCell(1).value).toBe(`'=HYPERLINK("x")`);
  });
});
