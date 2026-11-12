import { getItemMasters } from './item-master-cache';
import { effectiveItemMetadata, normalizedItemName, type Collections } from '@anomaly/core';

/** item name (normalised) -> its unit, from the item master. Only when every variant of the item agrees on one unit. */
export type UnitMap = Record<string, string>;

export async function loadUnits(c: Collections): Promise<UnitMap> {
  const masters = await getItemMasters(c);
  const seen = new Map<string, Set<string>>();
  for (const m of masters) {
    const unit = (effectiveItemMetadata(m).unit ?? '').trim();
    if (!unit) continue;
    const k = normalizedItemName(m.name);
    (seen.get(k) ?? seen.set(k, new Set()).get(k)!).add(unit);
  }
  return Object.fromEntries([...seen].filter(([, u]) => u.size === 1).map(([k, u]) => [k, [...u][0]!]));
}

/** The unit for an item key as the detector writes it: "name [unit:kg; pack:1]" carries its own unit; a plain name is looked up. '' when unknown. */
export function unitFor(item: string, units: UnitMap): string {
  const m = /\[unit:([^;\]]*)/.exec(item);
  if (m) { try { const u = decodeURIComponent(m[1]!).trim(); if (u && u !== 'unknown') return u; } catch { /* fall through */ } }
  return units[normalizedItemName(item.split(' [unit:')[0]!)] ?? '';
}

/** "13 kg" (or just "13" when the unit is not known). */
export const withUnit = (n: string, unit: string) => (unit ? `${n} ${unit}` : n);
