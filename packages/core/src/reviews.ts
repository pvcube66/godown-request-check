import type { Collections } from './db.js';

export interface ReviewGroup { label: string; reviewed: number; realProblems: number; falseAlarms: number }
export interface ReviewStats {
  reviewed: number; realProblems: number; falseAlarms: number;
  bySeverity: ReviewGroup[]; byKind: ReviewGroup[]; byBasis: ReviewGroup[];
}

const SEVERITY = { high: 'Check now', medium: 'Take a look', low: 'Minor' } as const;
const KIND = { spike: 'One item too high', typing: 'Same number typed for many items', order: 'Whole order too big' } as const;

/** Turns people's review clicks into an accuracy figure:
 *  "This looks wrong" = the detector was right (a real problem); "This is fine" / "Normal for this hostel" = a false alarm. */
export async function reviewStats(c: Collections): Promise<ReviewStats> {
  const docs = await c.anomalies.find(
    { status: { $in: ['confirmed', 'ignored', 'expected'] } },
    { projection: { severity: 1, kind: 1, method: 1, status: 1, 'peer.basis': 1 } },
  ).toArray();
  const group = (key: (d: (typeof docs)[number]) => string, order: string[]): ReviewGroup[] => {
    const m = new Map<string, ReviewGroup>();
    for (const d of docs) {
      const label = key(d);
      const g = m.get(label) ?? m.set(label, { label, reviewed: 0, realProblems: 0, falseAlarms: 0 }).get(label)!;
      g.reviewed++; d.status === 'confirmed' ? g.realProblems++ : g.falseAlarms++;
    }
    return [...m.values()].sort((a, b) => (order.indexOf(a.label) + 99) % 99 - (order.indexOf(b.label) + 99) % 99);
  };
  const real = docs.filter((d) => d.status === 'confirmed').length;
  return {
    reviewed: docs.length, realProblems: real, falseAlarms: docs.length - real,
    bySeverity: group((d) => SEVERITY[d.severity], Object.values(SEVERITY)),
    byKind: group((d) => KIND[d.kind as keyof typeof KIND] ?? d.kind, Object.values(KIND)),
    byBasis: group((d) => d.peer?.basis === 'students' ? 'Compared per student with similar hostels' : d.method === 'own-history' ? "Compared with the hostel's own months" : 'Estimated size (no student count)', []),
  };
}
