/** One cell of an Excel-friendly CSV. Text that starts with = + - @ is prefixed so a spreadsheet cannot run it as a formula
 *  (remarks and names are typed by people). Numbers are written as they are. */
export function csvCell(v: string | number | null | undefined): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** A download with a byte-order mark so Excel opens it with the right characters. */
export function csvResponse(filename: string, head: string[], rows: (string | number | null | undefined)[][]): Response {
  const body = '﻿' + [head.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n');
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` } });
}
