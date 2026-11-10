import { daysInStage, normalizedDistrictCode, OPEN_STAGES, scoped, STAGE_LABEL, STAGES, type Collections, type OrderDoc, type Stage } from '@anomaly/core';
import { orderFilter, STUCK_DAYS } from './orders';

export type View = 'overall' | 'district' | 'godown';
export const VIEWS: { key: View; label: string }[] = [
  { key: 'overall', label: 'Overall' },
  { key: 'district', label: 'District-wise' },
  { key: 'godown', label: 'Godown-wise' },
];

export type SummaryOrder = Pick<OrderDoc, 'account' | 'districtName' | 'hostelCode' | 'stage' | 'stageSince'>;

/** The stages shown as columns (Other is left out of the columns but is always in the total). */
export const SUMMARY_STAGES: Stage[] = STAGES.filter((s) => s !== 'other');

export interface SummaryRow {
  key: string; label: string;
  /** What to put in the order list's filter to see these orders. */
  filter: { district?: string; account?: string };
  hostels: number;
  byStage: Record<Stage, number>;
  total: number;
  /** Orders in an open stage that have sat there 7+ / 15+ days. */
  stuck7: number; stuck15: number;
}

const emptyByStage = (): Record<Stage, number> => Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;

/** One row per group. Counts come straight from the same orders the Order tracking tabs use, so the totals agree. */
export function summarize(orders: readonly SummaryOrder[], by: Exclude<View, 'overall'>, now: Date, godownLabel: (account: string) => string = (a) => a): SummaryRow[] {
  const rows = new Map<string, SummaryRow & { hostelSet: Set<string> }>();
  for (const o of orders) {
    const key = by === 'district' ? normalizedDistrictCode(o.districtName) || '(none)' : o.account;
    let r = rows.get(key);
    if (!r) {
      r = { key, label: by === 'district' ? (o.districtName.trim() || 'No district') : godownLabel(o.account), filter: by === 'district' ? { district: o.districtName.trim() } : { account: o.account }, hostels: 0, byStage: emptyByStage(), total: 0, stuck7: 0, stuck15: 0, hostelSet: new Set() };
      rows.set(key, r);
    }
    r.hostelSet.add(o.hostelCode); r.byStage[o.stage]++; r.total++;
    if (OPEN_STAGES.includes(o.stage)) {
      const d = daysInStage(o, now);
      if (d >= STUCK_DAYS[0]) r.stuck7++;
      if (d >= STUCK_DAYS[1]) r.stuck15++;
    }
  }
  return [...rows.values()].map(({ hostelSet, ...r }) => ({ ...r, hostels: hostelSet.size }))
    .sort((a, b) => b.stuck7 - a.stuck7 || b.total - a.total || a.label.localeCompare(b.label));
}

export interface StageRow { stage: Stage; label: string; orders: number; hostels: number; stuck7: number; stuck15: number }

/** The stage-wise table: how many orders and hostels are in each stage, and how many are stuck. */
export function stageSummary(orders: readonly SummaryOrder[], now: Date): { rows: StageRow[]; total: number } {
  const rows: StageRow[] = STAGES.map((s) => ({ stage: s, label: STAGE_LABEL[s], orders: 0, hostels: 0, stuck7: 0, stuck15: 0 }));
  const hostelSets = new Map<Stage, Set<string>>(STAGES.map((s) => [s, new Set()]));
  for (const o of orders) {
    const r = rows.find((x) => x.stage === o.stage)!;
    r.orders++; hostelSets.get(o.stage)!.add(o.hostelCode);
    if (OPEN_STAGES.includes(o.stage)) {
      const d = daysInStage(o, now);
      if (d >= STUCK_DAYS[0]) r.stuck7++;
      if (d >= STUCK_DAYS[1]) r.stuck15++;
    }
  }
  for (const r of rows) r.hostels = hostelSets.get(r.stage)!.size;
  return { rows: rows.filter((r) => r.stage !== 'other' || r.orders > 0), total: orders.length };
}

/** Only the few fields the dashboards need, for the person's districts (and one placed-in month if chosen). */
export async function loadSummaryOrders(c: Collections, names: string[] | null, month?: string): Promise<SummaryOrder[]> {
  return c.orders.find(scoped(orderFilter({ month }), names) as never, { projection: { account: 1, districtName: 1, hostelCode: 1, stage: 1, stageSince: 1 } }).toArray() as unknown as Promise<SummaryOrder[]>;
}

/** Godown name(s) for each portal login, so the godown-wise view says "JOGULAMBA" rather than a login id. */
export async function godownLabels(c: Collections): Promise<(account: string) => string> {
  const accts = await c.accounts.find({}, { projection: { username: 1, godowns: 1 } }).toArray();
  const m = new Map(accts.map((a) => [a.username, a.godowns.map((g) => g.name).join(', ') || a.username]));
  return (account) => m.get(account) ?? account;
}
