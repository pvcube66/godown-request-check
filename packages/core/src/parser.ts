import type { ParsedRequest } from './types.js';

const META_KEYS = new Set([
  'society_id', 'request_id', 'request_date', 'hostel_name', 'district_name', 'godown_name',
  'godown_contact_person', 'godown_contact_no', 'hostel_address', 'mobile', 'alt_mobile',
  'month_name', 'status', 'dc_number', 'dc_date',
]);

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

/** "15.00JS:15" -> 15 ; "20.25" -> 20.25 ; 0 -> 0 ; null/"" -> 0 */
export function parseQty(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v);
  const js = s.match(/JS:\s*(-?[\d.]+)/i);
  const n = parseFloat(js ? js[1]! : s);
  return Number.isFinite(n) ? n : 0;
}

/** Month the goods are for, as yyyy-mm. Year comes from the request date (handles Dec/Jan rollover). */
export function resolveMonth(requestDateDMY: string, monthName: string): { iso: string; month: string } {
  const [dd, mm, yyyy] = requestDateDMY.split('-').map(Number) as [number, number, number];
  const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const m = MONTHS.indexOf(monthName.trim().toLowerCase()) + 1;
  if (m === 0) throw new Error(`Unknown month name: ${monthName}`);
  let y = yyyy;
  if (mm === 12 && m === 1) y += 1;
  if (mm === 1 && m === 12) y -= 1;
  return { iso, month: `${y}-${String(m).padStart(2, '0')}` };
}

export function parseGodownRows(rows: Record<string, unknown>[], godownId: number): ParsedRequest[] {
  return rows.map((r) => {
    const hostelName = String(r.hostel_name ?? '');
    const { iso, month } = resolveMonth(String(r.request_date), String(r.month_name));
    const items: Record<string, number> = {};
    for (const [k, v] of Object.entries(r)) {
      if (!META_KEYS.has(k)) items[k.trim()] = parseQty(v);
    }
    return {
      godownId,
      requestId: String(r.request_id),
      societyId: String(r.society_id ?? ''),
      hostelCode: hostelName.split('-')[0]!.trim(),
      hostelName,
      districtName: String(r.district_name ?? ''),
      godownName: String(r.godown_name ?? ''),
      requestDate: iso,
      month,
      status: String(r.status ?? ''),
      dcNumber: r.dc_number == null ? null : String(r.dc_number),
      items,
    };
  });
}
