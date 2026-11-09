import type { AnomalyDoc } from '@anomaly/core';

export interface TypingGroup { month: string; value: number; items: AnomalyDoc[] }

/** Splits a hostel's flags into "same number typed for many items" groups and single-item spikes. */
export function groupFlags(rows: AnomalyDoc[]): { typing: TypingGroup[]; spikes: AnomalyDoc[] } {
  const typing = new Map<string, TypingGroup>();
  const spikes: AnomalyDoc[] = [];
  for (const a of rows) {
    if (a.kind === 'typing' && a.slip) {
      const k = `${a.month}|${a.slip.value}`;
      (typing.get(k) ?? typing.set(k, { month: a.month, value: a.slip.value, items: [] }).get(k)!).items.push(a);
    } else spikes.push(a);
  }
  return { typing: [...typing.values()].sort((a, b) => b.items.length - a.items.length), spikes };
}
