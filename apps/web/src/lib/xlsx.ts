import ExcelJS from 'exceljs';

export type XCell = string | number | Date | null | undefined;
export interface XSheet { name: string; head: string[]; rows: XCell[][] }

/** Text that starts with = + - @ is stored as plain text with a leading quote mark so a spreadsheet can never run it as a formula. */
const safe = (v: XCell): string | number | Date | null => {
  if (v == null) return null;
  if (typeof v === 'string') return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return v;
};

/** A real .xlsx download: the data sheet, plus a "Filters" sheet that records which choices were applied. */
export async function xlsxResponse(filename: string, sheet: XSheet, filters: [string, string][]): Promise<Response> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet(sheet.name.slice(0, 31));
  ws.addRow(sheet.head.map(safe));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of sheet.rows) ws.addRow(r.map(safe));
  ws.columns.forEach((col, i) => {
    const longest = Math.max(sheet.head[i]?.length ?? 8, ...sheet.rows.slice(0, 200).map((r) => String(r[i] instanceof Date ? 'dd Mon yyyy' : r[i] ?? '').length));
    col.width = Math.min(50, Math.max(9, longest + 2));
  });
  const fs = wb.addWorksheet('Filters');
  fs.addRow(['Filter', 'Applied']); fs.getRow(1).font = { bold: true };
  for (const [k, v] of filters) fs.addRow([k, safe(v || 'All')]);
  fs.addRow(['Rows in this file', sheet.rows.length]);
  fs.addRow(['Downloaded', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })]);
  fs.getColumn(1).width = 24; fs.getColumn(2).width = 40;
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${filename}"`,
  } });
}
