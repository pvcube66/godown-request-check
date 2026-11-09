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
  slipMinGroup: number;    // same number typed for at least this many items in one request ...
  slipRatio: number;       // ... and at least this many times each item's usual amount
  slipFraction: number;    // share of the repeated items that must be far above usual
  sizeBand: number;        // compare with hostels having between 1/band and band x this hostel's students
  orderMinItems: number;   // whole-order check: needs at least this many items compared per student ...
  orderRatio: number;      // ... and the typical item at least this many times what similar-sized hostels ask
}

export const DEFAULT_CONFIG: DetectorConfig = {
  ownRatio: 3, ownMinHistory: 2, peerRatio: 4, minExcess: 5, minPeers: 8,
  minItemsForScale: 5, itemMinExcess: {}, expectedLimit: 6,
  slipMinGroup: 3, slipRatio: 3, slipFraction: 0.6, sizeBand: 2, orderMinItems: 8, orderRatio: 3,
};

export type Candidate = Omit<AnomalyDoc, 'detectedAt' | 'updatedAt' | 'lastSeenAt' | 'status'>;
type Req = Pick<RequestDoc, 'godownId' | 'hostelCode' | 'hostelName' | 'districtName' | 'month' | 'status' | 'items'>;

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
/** Value at quantile q (0..1) with linear interpolation. */
const quantile = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  if (!s.length) return 0;
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
};
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** True when ratio is very close to 10, 100 or 1000: the classic "extra zero" typing slip. */
function nearPowerOfTen(ratio: number): boolean {
  return [10, 100, 1000].some((p) => ratio >= p * 0.85 && ratio <= p * 1.15);
}

function severity(ratio: number, method: 'own-history' | 'peers'): 'low' | 'medium' | 'high' {
  const [hi, med] = method === 'own-history' ? [8, 5] : [10, 6];
  return ratio >= hi ? 'high' : ratio >= med ? 'medium' : 'low';
}

/** Pure function: totals per hostel+month (rejected requests ignored), then flags spikes. */
/** `sizes` maps "godownId|hostelCode" to the number of students (when known). With it, requests are compared per student
 *  against hostels of a similar size; without it the size is estimated from the order itself. */
export function detectAnomalies(reqs: Req[], evalMonths: string[], cfg: DetectorConfig = DEFAULT_CONFIG, sizes: Map<string, number> = new Map()): Candidate[] {
  // 1. aggregate: godown|hostel|month -> item totals
  const agg = new Map<string, { meta: Req; items: Record<string, number> }>();
  const perRequest = new Map<string, Record<string, number>[]>();
  for (const r of reqs) {
    if (/^reject/i.test(r.status)) continue;
    const k = `${r.godownId}|${r.hostelCode}|${r.month}`;
    const e = agg.get(k) ?? { meta: r, items: {} };
    for (const [it, q] of Object.entries(r.items)) e.items[it] = (e.items[it] ?? 0) + q;
    agg.set(k, e);
    (perRequest.get(k) ?? perRequest.set(k, []).get(k)!).push(r.items);
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
      // per-student rates for hostels whose student count is known
      const rateVals = new Map<string, { rate: number; students: number; hostel: string }[]>();
      for (const [k, e] of cur) {
        const st = sizes.get(`${gid}|${k.split('|')[1]}`);
        if (!st || st <= 0) continue;
        for (const [it, q] of Object.entries(e.items)) if (q > 0) (rateVals.get(it) ?? rateVals.set(it, []).get(it)!).push({ rate: q / st, students: st, hostel: k.split('|')[1]! });
      }

      for (const [key, e] of cur) {
        const hostel = key.split('|')[1]!;
        // hostel size scale: median of (qty / peer median) across its items
        const ratios = Object.entries(e.items).filter(([it, q]) => q > 0 && (peerMed.get(it) ?? 0) > 0).map(([it, q]) => q / peerMed.get(it)!);
        const scale = ratios.length >= cfg.minItemsForScale ? median(ratios) : 0;

        // own history = earlier months for this hostel
        const hist = [...agg.entries()]
          .filter(([k]) => k.startsWith(`${gid}|${hostel}|`) && k.split('|')[2]! < month)
          .sort((a, b) => b[0].split('|')[2]!.localeCompare(a[0].split('|')[2]!)).slice(0, cfg.expectedLimit);

        const students = sizes.get(`${gid}|${hostel}`);
        /** What hostels like this one ask for an item. Per student, against hostels of a similar size, when the
         *  student count is known; otherwise an estimate based on the size of the order itself. */
        const peerInfo = (item: string) => {
          if (students && students > 0) {
            const all = (rateVals.get(item) ?? []).filter((p) => p.hostel !== hostel);
            const near = all.filter((p) => p.students >= students / cfg.sizeBand && p.students <= students * cfg.sizeBand);
            const use = near.length >= cfg.minPeers ? near : all;
            if (use.length >= cfg.minPeers) {
              const rates = use.map((p) => p.rate), sz = use.map((p) => p.students);
              return { expected: median(rates) * students, low: quantile(rates, 0.25) * students, high: quantile(rates, 0.75) * students,
                count: use.length, basis: 'students' as const, sizeRange: [Math.min(...sz), Math.max(...sz)] as [number, number] };
            }
          }
          const v = peerVals.get(item), pmed = peerMed.get(item) ?? 0;
          if (!v || v.length < cfg.minPeers || scale <= 0 || !pmed) return undefined;
          return { expected: pmed * scale, low: quantile(v, 0.25) * scale, high: quantile(v, 0.75) * scale, count: v.length, basis: 'estimated' as const, sizeRange: undefined };
        };
        const peerStat = (item: string): Candidate['peer'] => {
          const p = peerInfo(item);
          return p && { count: p.count, low: round(p.low), high: round(p.high), typical: round(p.expected), basis: p.basis, ...(p.sizeRange ? { sizeRange: p.sizeRange } : {}) };
        };
        const expectation = new Map<string, { expected: number; method: 'own-history' | 'peers' }>();
        const found = new Map<string, Candidate>();

        for (const [item, qty] of Object.entries(e.items)) {
          if (qty <= 0) continue;
          const minExcess = cfg.itemMinExcess[item] ?? cfg.minExcess;
          const past = hist.map(([, h]) => h.items[item] ?? 0).filter((q) => q > 0);   // zeros are not "usual need"
          const pInfo = peerInfo(item);
          let method: 'own-history' | 'peers' | null = null;
          let expected = 0;

          if (past.length >= cfg.ownMinHistory) { method = 'own-history'; expected = median(past); }
          else if (pInfo && pInfo.expected > 0) { method = 'peers'; expected = pInfo.expected; }
          if (!method || expected <= 0) continue;
          expectation.set(item, { expected, method });

          const limit = method === 'own-history' ? cfg.ownRatio : cfg.peerRatio;
          if (qty < limit * expected || qty - expected < minExcess) continue;
          let reason = method === 'own-history'
            ? `Asked ${qty} but this hostel usually asks ~${round(expected)} (last ${past.length} months: ${past.join(', ')})`
            : `Asked ${qty}; hostels like it ask ~${round(expected)}` + (past.length ? ` (this hostel's only earlier request: ${past[0]})` : ' (no earlier history for this hostel)');
          if (method === 'own-history' && pInfo) reason += `; other hostels like it ask ~${round(pInfo.expected)}`;
          const ratio = qty / expected;
          found.set(item, {
            key: `${gid}|${hostel}|${month}|${item}`, godownId: gid, hostelCode: hostel,
            hostelName: e.meta.hostelName, districtName: e.meta.districtName, month, item,
            requested: round(qty), expected: round(expected), ratio: round(ratio, 1), score: round(Math.log2(ratio), 2),
            severity: severity(ratio, method), method, kind: 'spike', partOfOrder: false, looksLikeExtraZero: nearPowerOfTen(ratio), peer: peerStat(item), ...(students ? { students } : {}), reason,
          });
        }

        // Typing slips: the same number entered for several items in ONE request, far above each item's usual.
        // (Repeated round numbers alone are normal; it is the "far above usual" part that gives it away.)
        for (const items of perRequest.get(key) ?? []) {
          const byValue = new Map<number, string[]>();
          for (const [it, q] of Object.entries(items)) if (q > 0) (byValue.get(q) ?? byValue.set(q, []).get(q)!).push(it);
          for (const [value, names] of byValue) {
            if (names.length < cfg.slipMinGroup) continue;
            const over = names.filter((it) => {
              const x = expectation.get(it);
              return x && value >= cfg.slipRatio * x.expected && value - x.expected >= (cfg.itemMinExcess[it] ?? cfg.minExcess);
            });
            if (over.length < cfg.slipMinGroup || over.length < cfg.slipFraction * names.length) continue;
            for (const it of over) {
              const x = expectation.get(it)!;
              const qty = e.items[it]!;
              const ratio = qty / x.expected;
              const base = found.get(it);
              found.set(it, {
                ...(base ?? {
                  key: `${gid}|${hostel}|${month}|${it}`, godownId: gid, hostelCode: hostel,
                  hostelName: e.meta.hostelName, districtName: e.meta.districtName, month, item: it,
                  requested: round(qty), expected: round(x.expected), ratio: round(ratio, 1), score: round(Math.log2(ratio), 2),
                  method: x.method, peer: peerStat(it), ...(students ? { students } : {}), reason: '',
                }),
                severity: 'high', kind: 'typing', slip: { value, count: over.length, items: over },
                looksLikeExtraZero: false,
                reason: `The same number (${value}) was entered for ${over.length} different items, far above what is usual for each. Likely a typing mistake.`,
              });
            }
          }
        }
        // Whole-order check: when the typical item is far above what similar-sized hostels ask per student,
        // that is one finding about the whole order, not many separate item mistakes.
        if (students && students > 0) {
          const ratiosOrder: number[] = [];
          for (const [item, qty] of Object.entries(e.items)) {
            const pi = qty > 0 ? peerInfo(item) : undefined;
            if (pi && pi.basis === 'students' && pi.expected > 0) ratiosOrder.push(qty / pi.expected);
          }
          if (ratiosOrder.length >= cfg.orderMinItems) {
            const r = median(ratiosOrder);
            if (r >= cfg.orderRatio) {
              found.set('(whole order)', {
                key: `${gid}|${hostel}|${month}|(whole order)`, godownId: gid, hostelCode: hostel,
                hostelName: e.meta.hostelName, districtName: e.meta.districtName, month, item: '(whole order)',
                requested: round(r, 1), expected: 1, ratio: round(r, 1), score: round(Math.log2(r), 2),
                severity: r >= 6 ? 'high' : r >= 4 ? 'medium' : 'low', method: 'peers', kind: 'order',
                order: { itemsCompared: ratiosOrder.length }, students,
                reason: `The typical item is ${round(r, 1)} times what hostels with a similar number of students ask per student (${ratiosOrder.length} items compared).`,
              });
            }
          }
        }
        if (found.has('(whole order)')) for (const f of found.values()) if (f.kind === 'spike') f.partOfOrder = true;
        out.push(...found.values());
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
  const sizes = new Map((await c.hostels.find({ students: { $gt: 0 } }).toArray()).map((h) => [`${h.godownId}|${h.hostelCode}`, h.students!] as const));
  const found = detectAnomalies(reqs, evalMonths, cfg, sizes);
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
