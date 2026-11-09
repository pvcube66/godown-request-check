import type { AnomalyDoc, Collections, RequestDoc } from './db.js';

export interface DetectorConfig {
  ownRatio: number;        // flag if request >= this x the hostel's own usual quantity
  ownMinHistory: number;   // months of own (non-zero) history needed to trust it
  peerRatio: number;       // stricter ratio used against peers (history thin)
  minExcess: number;       // ignore if the extra quantity is smaller than this (avoids noise on tiny items)
  minPeers: number;        // need this many hostels ordering the item to compare with peers
  minItemsForScale: number;
  itemMinExcess: Record<string, number>;   // per-item override of minExcess
  expectedLimit: number;   // history window (months) used for own median
}

export const DEFAULT_CONFIG: DetectorConfig = {
  ownRatio: 3, ownMinHistory: 2, peerRatio: 4, minExcess: 5, minPeers: 8,
  minItemsForScale: 5, itemMinExcess: {}, expectedLimit: 6,
};

export type Candidate = Omit<AnomalyDoc, 'detectedAt' | 'updatedAt' | 'lastSeenAt' | 'status'>;
type Req = Pick<RequestDoc, 'godownId' | 'hostelCode' | 'hostelName' | 'districtName' | 'month' | 'status' | 'items'>;

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function severity(ratio: number, method: 'own-history' | 'peers'): 'low' | 'medium' | 'high' {
  const [hi, med] = method === 'own-history' ? [8, 5] : [10, 6];
  return ratio >= hi ? 'high' : ratio >= med ? 'medium' : 'low';
}

/** Pure function: totals per hostel+month (rejected requests ignored), then flags spikes. */
export function detectAnomalies(reqs: Req[], evalMonths: string[], cfg: DetectorConfig = DEFAULT_CONFIG): Candidate[] {
  // 1. aggregate: godown|hostel|month -> item totals
  const agg = new Map<string, { meta: Req; items: Record<string, number> }>();
  for (const r of reqs) {
    if (/^reject/i.test(r.status)) continue;
    const k = `${r.godownId}|${r.hostelCode}|${r.month}`;
    const e = agg.get(k) ?? { meta: r, items: {} };
    for (const [it, q] of Object.entries(r.items)) e.items[it] = (e.items[it] ?? 0) + q;
    agg.set(k, e);
  }
  const out: Candidate[] = [];
  const godowns = [...new Set(reqs.map((r) => r.godownId))];

  for (const gid of godowns) {
    const rowsOf = (month: string) => [...agg.entries()].filter(([k]) => k.startsWith(`${gid}|`) && k.endsWith(`|${month}`));
    for (const month of evalMonths) {
      const cur = rowsOf(month);
      if (!cur.length) continue;
      // peer medians per item for this month
      const peerVals = new Map<string, number[]>();
      for (const [, e] of cur) for (const [it, q] of Object.entries(e.items)) if (q > 0) (peerVals.get(it) ?? peerVals.set(it, []).get(it)!).push(q);
      const peerMed = new Map([...peerVals].map(([it, v]) => [it, v.length >= cfg.minPeers ? median(v) : 0]));

      for (const [key, e] of cur) {
        const hostel = key.split('|')[1]!;
        // hostel size scale: median of (qty / peer median) across its items
        const ratios = Object.entries(e.items).filter(([it, q]) => q > 0 && (peerMed.get(it) ?? 0) > 0).map(([it, q]) => q / peerMed.get(it)!);
        const scale = ratios.length >= cfg.minItemsForScale ? median(ratios) : 0;

        // own history = earlier months for this hostel
        const hist = [...agg.entries()]
          .filter(([k]) => k.startsWith(`${gid}|${hostel}|`) && k.split('|')[2]! < month)
          .sort((a, b) => b[0].split('|')[2]!.localeCompare(a[0].split('|')[2]!)).slice(0, cfg.expectedLimit);

        for (const [item, qty] of Object.entries(e.items)) {
          if (qty <= 0) continue;
          const minExcess = cfg.itemMinExcess[item] ?? cfg.minExcess;
          const past = hist.map(([, h]) => h.items[item] ?? 0).filter((q) => q > 0);   // zeros are not "usual need"
          const pm = peerMed.get(item) ?? 0;
          let method: 'own-history' | 'peers' | null = null;
          let expected = 0, reason = '';

          if (past.length >= cfg.ownMinHistory) {
            expected = median(past);
            if (qty >= cfg.ownRatio * expected && qty - expected >= minExcess) {
              method = 'own-history';
              reason = `Asked ${qty} but this hostel usually asks ~${round(expected)} (last ${past.length} months: ${past.join(', ')})`;
              if (scale && pm) reason += `; other hostels ask ~${round(pm * scale)} for a hostel this size`;
            }
          } else if (scale > 0 && pm > 0) {
            expected = scale * pm;
            if (qty >= cfg.peerRatio * expected && qty - expected >= minExcess) {
              method = 'peers';
              reason = `Asked ${qty}; hostels of similar size ask ~${round(expected)}` +
                (past.length ? ` (this hostel's only earlier request: ${past[0]})` : ' (no earlier history for this hostel)');
            }
          }
          if (!method) continue;
          const ratio = qty / expected;
          out.push({
            key: `${gid}|${hostel}|${month}|${item}`, godownId: gid, hostelCode: hostel,
            hostelName: e.meta.hostelName, districtName: e.meta.districtName, month, item,
            requested: round(qty), expected: round(expected), ratio: round(ratio, 1), score: round(Math.log2(ratio), 2),
            severity: severity(ratio, method), method, reason,
          });
        }
      }
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

/** Months worth checking by default: last month, this month and the next two. */
export function defaultEvalMonths(now = new Date()): string[] {
  return [-1, 0, 1, 2].map((d) => {
    const x = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + d, 1));
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** Loads config overrides (settings collection), runs detection and saves results.
 *  Re-detected anomalies keep any review decision; anomalies that disappeared are marked resolved. */
export async function runDetection(c: Collections, evalMonths = defaultEvalMonths()): Promise<{ found: number; created: number }> {
  const saved = await c.settings.findOne({ _id: 'detector' });
  const cfg = { ...DEFAULT_CONFIG, ...((saved?.value as Partial<DetectorConfig>) ?? {}) };
  const reqs = await c.requests.find({}, { projection: { items: 1, godownId: 1, hostelCode: 1, hostelName: 1, districtName: 1, month: 1, status: 1 } }).toArray();
  const found = detectAnomalies(reqs, evalMonths, cfg);
  const now = new Date();
  let created = 0;
  for (const a of found) {
    const r = await c.anomalies.updateOne({ key: a.key }, {
      $set: { ...a, lastSeenAt: now, updatedAt: now },
      $setOnInsert: { status: 'open', detectedAt: now },
    }, { upsert: true });
    if (r.upsertedCount) created++;
  }
  // reopen nothing automatically; mark open ones no longer flagged as resolved
  await c.anomalies.updateMany(
    { status: 'open', month: { $in: evalMonths }, key: { $nin: found.map((f) => f.key) } },
    { $set: { status: 'resolved', updatedAt: now } },
  );
  return { found: found.length, created };
}
