import { itemVariantKey, normalizedItemName } from '@anomaly/core';
import type { History } from './history';

export interface ItemChange { item: string; thisMonth: number; earlierAverage: number; earlierMonths: number; ratio: number | null }

/** For one month: each item's quantity against the hostel's own average of the months before it.
 *  Only months in which the hostel placed a request count as "earlier months"; items it did not ask for count as 0 in those months. */
export function monthComparison(h: History[string] | undefined, requestMonths: readonly string[], month: string): ItemChange[] {
  if (!h) return [];
  const earlier = requestMonths.filter((m) => m < month);
  return Object.keys(h).map((item) => {
    const thisMonth = h[item]![month] ?? 0;
    const sum = earlier.reduce((n, m) => n + (h[item]![m] ?? 0), 0);
    const avg = earlier.length ? sum / earlier.length : 0;
    return { item, thisMonth, earlierAverage: avg, earlierMonths: earlier.length, ratio: avg > 0 ? thisMonth / avg : null };
  }).filter((r) => r.thisMonth > 0 || r.earlierAverage > 0)
    .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.thisMonth - a.thisMonth || a.item.localeCompare(b.item));
}

/** Every calendar month (yyyy-mm) from the first to the last month with a request, so a month with no indent can still be picked. */
export function monthRange(months: readonly string[]): string[] {
  const sorted = [...new Set(months)].sort();
  if (!sorted.length) return [];
  const out: string[] = [];
  let [y, m] = sorted[0]!.split('-').map(Number) as [number, number];
  const last = sorted[sorted.length - 1]!;
  for (let guard = 0; guard < 240; guard++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= last) break;
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** Plain words for how this month's size compares with usual. */
export function sizeWords(ratio: number | null): string {
  if (ratio === null) return 'no earlier months to compare';
  if (ratio >= 2) return `${ratio.toFixed(1)} times the usual`;
  if (ratio >= 1.25) return 'a bit more than usual';
  if (ratio > 0.8) return 'about the usual';
  if (ratio > 0) return 'less than usual';
  return 'none this month';
}

/** The item's unit-less display key is the same one the history uses; this recovers the plain name for a unit lookup. */
export const historyItemName = (key: string) => (key.includes(' [unit:') ? key.split(' [unit:')[0]! : key);
export const sameItem = (rowName: string, historyKey: string) => normalizedItemName(rowName) === normalizedItemName(historyItemName(historyKey));

const unitOfKey = (key: string): string => { const m = /\[unit:([^;\]]*)/.exec(key); const u = m ? decodeURIComponent(m[1]!).trim().toLowerCase() : ''; return u === 'unknown' ? '' : u; };

/** One item's month-by-month quantities for a hostel. The item can be saved under more than one key (with a unit and pack size, or as a plain name,
 *  depending on when the unit details were read), so the exact key is used first and any other key for the same item with the same (or unknown) unit
 *  fills the months it is missing. Different units are never added together. */
export function seriesFor(h: Record<string, Record<string, number>> | undefined, item: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!h) return out;
  const exact = h[item];
  const base = normalizedItemName(historyItemName(item)), unit = unitOfKey(item);
  const months = new Set<string>(Object.keys(exact ?? {}));
  const others = Object.keys(h).filter((k) => k !== item && normalizedItemName(historyItemName(k)) === base && (!unit || !unitOfKey(k) || unitOfKey(k) === unit));
  for (const k of others) for (const m of Object.keys(h[k]!)) months.add(m);
  for (const m of months) {
    if (exact && m in exact && exact[m]! > 0) { out[m] = exact[m]!; continue; }
    const fromOthers = others.reduce((n, k) => n + (h[k]![m] ?? 0), 0);
    out[m] = fromOthers > 0 ? fromOthers : (exact?.[m] ?? 0);
  }
  return out;
}
export { itemVariantKey };
