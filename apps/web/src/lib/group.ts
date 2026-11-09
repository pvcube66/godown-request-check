import type { AnomalyDoc } from '@anomaly/core';

export interface TypingGroup { month: string; value: number; items: AnomalyDoc[] }

/** Splits a hostel's flags into "same number typed for many items" groups and single-item spikes. */
export function groupFlags(rows: AnomalyDoc[]): { orders: AnomalyDoc[]; duplicates: AnomalyDoc[]; typing: TypingGroup[]; spikes: AnomalyDoc[] } {
  const typing = new Map<string, TypingGroup>();
  const spikes: AnomalyDoc[] = [];
  const orders: AnomalyDoc[] = [];
  const duplicates: AnomalyDoc[] = [];
  for (const a of rows) {
    if (a.kind === 'order') orders.push(a);
    else if (a.kind === 'duplicate') duplicates.push(a);
    else if (a.kind === 'typing' && a.slip) {
      const k = `${a.month}|${a.slip.value}`;
      (typing.get(k) ?? typing.set(k, { month: a.month, value: a.slip.value, items: [] }).get(k)!).items.push(a);
    } else spikes.push(a);
  }
  return { orders, duplicates, typing: [...typing.values()].sort((a, b) => b.items.length - a.items.length), spikes };
}
