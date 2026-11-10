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
export { itemVariantKey };
