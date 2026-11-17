import { getDb } from '@/lib/db';
import { loadItemNames } from '@/lib/item-names';
import { loadUnits } from '@/lib/units';
import { AccessError, actorOf, requireAccess, visibleDistricts } from '@/lib/viewer';
import { monthLabel } from '@/lib/format';
import { loadReport, REPORT_HEAD, reportRows } from '@/lib/report';
import { xlsxResponse } from '@/lib/xlsx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SEV = { all: 'All', high: 'Check now', medium: 'Take a look', low: 'Minor' } as const;
const VIEW = { open: 'To check', confirmed: 'Issues raised', fine: 'Marked fine' } as const;
const KIND = { spike: 'Unusual quantity', typing: 'Same number typed', order: 'Whole order too big', duplicate: 'Possible duplicate' } as const;

/** The Unusual Requests screen as a real Excel file, with every choice on the screen (month, godown, district, importance, type, list, search) applied. */
export async function GET(req: Request) {
  let viewer;
  try { viewer = await requireAccess('view'); } catch (e) { return new Response('Please sign in again.', { status: e instanceof AccessError ? e.status : 401 }); }
  const u = new URL(req.url);
  const g = (k: string) => u.searchParams.get(k) ?? '';
  const sev = (['all', 'high', 'medium', 'low'] as const).find((s) => s === g('sev')) ?? 'high';
  const view = (['open', 'confirmed', 'fine'] as const).find((v) => v === g('view')) ?? 'open';
  const kind = (Object.keys(KIND) as (keyof typeof KIND)[]).find((k) => k === g('kind')) ?? '';
  const c = await getDb();
  const [itemNames, units, godowns] = await Promise.all([loadItemNames(c), loadUnits(c), c.godowns.find({}, { projection: { godownId: 1, name: 1 } }).toArray()]);
  const godown = /^\d{1,9}$/.test(g('godown')) ? g('godown') : '';
  const rows = await loadReport(c, { month: g('month'), district: g('district'), q: g('q'), sev, kind, view, godown }, await visibleDistricts(c, viewer));
  const now = new Date();
  await c.auditLog.insertOne({ actor: actorOf(viewer), action: 'export.report.xlsx', target: 'report', at: now, details: { rows: rows.length, sev, view, kind, month: g('month'), district: g('district'), godown } });
  return xlsxResponse(`unusual-requests-${now.toISOString().slice(0, 10)}.xlsx`, { name: 'Unusual requests', head: REPORT_HEAD, rows: reportRows(rows, itemNames, units) }, [
    ['Month', g('month') ? monthLabel(g('month')) : ''],
    ['Godown', godown ? (godowns.find((x) => String(x.godownId) === godown)?.name ?? godown) : ''],
    ['District', g('district')],
    ['Importance', SEV[sev]],
    ['Type', kind ? KIND[kind] : ''],
    ['List', VIEW[view]],
    ['Search', g('q')],
  ]);
}
