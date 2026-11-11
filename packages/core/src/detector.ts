import type { AnomalyDoc, Collections, RequestDoc } from './db.js';
import { comparisonItems, itemVariantKey, normalizedItemName } from './itemMaster.js';

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
  sizeBand: number;        // hostels within 1/band .. band x this hostel's students count as 'close in size'
  peerK: number;           // use at most this many of the closest-in-size hostels (more is steadier, fewer is more alike)
  peerZ: number;           // how far outside the normal spread of similar hostels (in robust standard deviations, log scale)
  madFloor: number;        // smallest natural spread assumed (log scale) so very tight items do not become hair-triggers
  floorFrac: number;       // ignore differences smaller than this share of the item's typical order (learned per item)
  ownCorroborated: number; // own-history ratio needed when similar hostels also say it is high
  ownVolatile: number;     // own-history ratio needed when the hostel's own months already vary a lot
  ownAbovePeers: boolean;  // an own-history jump must also be above the normal range of similar hostels
  peersByKind: boolean;    // when the student count is unknown, compare with the same kind of hostel (same society) first
  hostelEffect: boolean;   // also learn each hostel's usual level from its OTHER items, and judge an item against that
  hostelEffectRating: boolean; // use that level only to rate how unusual an already-flagged item is (adds no new flags)
  dupSimilarity: number;   // two requests from one hostel in one month this alike (0..1) count as a duplicate
  dupMinItems: number;     // ... and must each ask for at least this many different items
  orderMinItems: number;   // whole-order check: needs at least this many items compared per student ...
  orderRatio: number;      // ... and the typical item at least this many times what similar-sized hostels ask
  ownConsistency: number;  // never flag a quantity within this many times of the largest amount the hostel asked in any OTHER month
  minExcessUnits: Record<string, number>; // smallest extra quantity worth a flag, by unit (kg, litre ...)
  minExcessOther: number;  // ... for any other unit
  minStudents: number;     // student counts below this are not trusted (a partial attendance day); the size is then estimated instead
  dropMinor: boolean;      // do not store flags that would only be rated Minor
}

export const DEFAULT_CONFIG: DetectorConfig = {
  ownRatio: 3, ownMinHistory: 2, peerRatio: 2.5, minExcess: 0.1, minPeers: 8,
  minItemsForScale: 5, itemMinExcess: {}, expectedLimit: 6,
  slipMinGroup: 3, slipRatio: 3, slipFraction: 0.6, sizeBand: 2, peerK: 40, peerZ: 1, madFloor: 0.3, floorFrac: 0.15, ownCorroborated: 2.2, ownVolatile: 4, ownAbovePeers: false, peersByKind: true, hostelEffect: false, hostelEffectRating: false, dupSimilarity: 0.9, dupMinItems: 4, orderMinItems: 8, orderRatio: 2.5, ownConsistency: 1.5, minExcessUnits: { kg: 1, litre: 1, ltr: 1, l: 1, liter: 1, litres: 1 }, minExcessOther: 3, minStudents: 30, dropMinor: true,
};

export type Candidate = Omit<AnomalyDoc, 'detectedAt' | 'updatedAt' | 'lastSeenAt' | 'status'>;
export type Req = Pick<RequestDoc, 'godownId' | 'hostelCode' | 'hostelName' | 'districtName' | 'month' | 'status' | 'items' | 'itemSnapshots'> & { societyId?: string; requestId?: string; requestDate?: string };

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
/** The part of an item that does NOT change when its unit or pack size is read later: its normalized name.
 *  Flags are identified by this, so filling in a unit does not make the same flag look new (and lose its review). */
export const stableItemName = (item: string): string => normalizedItemName(item.includes(' [unit:') ? item.split(' [unit:')[0]! : item);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** How serious a flag is. Combines the size of the jump with how far outside the natural spread it falls,
 *  so a big jump on an item that naturally varies a lot is rated lower than the same jump on a steady item. */
function severity(ratio: number, method: 'own-history' | 'peers' | 'blend', z: number, withinNormal: boolean): 'low' | 'medium' | 'high' {
  if (withinNormal) return 'low';        // still inside what similar hostels normally ask: at most a minor note
  if (method === 'own-history') return ratio >= 8 ? 'high' : ratio >= 4 ? 'medium' : 'low';
  if (ratio >= 8 && z >= 2.5) return 'high';
  if (ratio >= 4 && z >= 1.5) return 'medium';
  return 'low';
}

/** Pure function: totals per hostel+month (rejected requests ignored), then flags spikes. */
/** `sizes` maps "godownId|hostelCode" to the number of students (when known). With it, requests are compared per student
 *  against hostels of a similar size; without it the size is estimated from the order itself. */
export function detectAnomalies(reqs: Req[], evalMonths: string[], cfg: DetectorConfig = DEFAULT_CONFIG, sizes: Map<string, number> = new Map()): Candidate[] {
  // A student count that is far too small (the portal's attendance report for a day with only some classes marked) would make every
  // per-student comparison look huge, so it is not trusted: those hostels are compared by the size of their own order instead.
  sizes = new Map([...sizes].filter(([, n]) => n >= cfg.minStudents));
  const baseNames = new Map<string, string>();
  for (const r of reqs) for (const s of r.itemSnapshots ?? []) {
    if (s.unit?.trim() || s.packSize?.trim()) baseNames.set(itemVariantKey(s), normalizedItemName(s.name));
  }
  const baseName = (item: string) => baseNames.get(item) ?? normalizedItemName(item);
  reqs = reqs.map((r) => r.itemSnapshots ? { ...r, items: comparisonItems(r) } : r);
  // 0. duplicate requests: two live requests from one hostel in one month that are almost identical.
  //    The later copy is flagged. It is still counted in the totals, because if nobody cancels it the hostel really does receive
  //    everything twice (or three times), and the amounts should be judged as they would actually be delivered.
  const dropped = new Set<Req>();
  const dupFlags: Candidate[] = [];
  {
    const groups = new Map<string, Req[]>();
    reqs.forEach((r, i) => { if (/^reject/i.test(r.status)) return; const k = `${r.godownId}|${r.hostelCode}|${r.month}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); void i; });
    const idOf = (r: Req, i: number) => r.requestId ?? `#${i}`;
    for (const [k, rs] of groups) {
      if (rs.length < 2) continue;
      rs.sort((a, b) => `${a.requestDate ?? ''}${a.requestId ?? ''}`.localeCompare(`${b.requestDate ?? ''}${b.requestId ?? ''}`));
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        if (dropped.has(rs[j]!) || dropped.has(rs[i]!)) continue;
        const a = rs[i]!, b = rs[j]!;
        // A small quantity in another unit/pack must not disappear under a large common item.
        const variants = (r: Req) => {
          const byName = new Map<string, Set<string>>();
          for (const [item, qty] of Object.entries(r.items)) if (qty > 0) {
            const name = baseName(item);
            (byName.get(name) ?? byName.set(name, new Set()).get(name)!).add(item);
          }
          return byName;
        };
        const variantsA = variants(a), variantsB = variants(b);
        if ([...variantsA].some(([name, keys]) => {
          const other = variantsB.get(name);
          return other && (keys.size !== other.size || [...keys].some((key) => !other.has(key)));
        })) continue;
        let sumMin = 0, sumMax = 0, totalB = 0;
        const namesA = new Set<string>(), namesB = new Set<string>();
        for (const it of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) {
          const x = a.items[it] ?? 0, y = b.items[it] ?? 0;
          if (x <= 0 && y <= 0) continue;
          sumMin += Math.min(x, y); sumMax += Math.max(x, y);
          if (x > 0) namesA.add(baseName(it));
          if (y > 0) namesB.add(baseName(it));
          totalB += y;
        }
        const sim = sumMax > 0 ? sumMin / sumMax : 0, n = Math.min(namesA.size, namesB.size);
        if (sim < cfg.dupSimilarity || n < cfg.dupMinItems) continue;
        dropped.add(b);
        const [g, h, m] = k.split('|') as [string, string, string];
        if (!evalMonths.includes(m)) continue;
        const idA = idOf(a, reqs.indexOf(a)), idB = idOf(b, reqs.indexOf(b));
        dupFlags.push({
          key: `${g}|${h}|${m}|(duplicate)|${idB}`, godownId: Number(g), hostelCode: h, hostelName: b.hostelName, districtName: b.districtName, month: m,
          item: '(duplicate request)', requested: round(totalB), expected: 0, ratio: round(sim * 100, 0), score: 0,
          severity: sim >= 0.98 && n >= 10 ? 'high' : 'medium', method: 'own-history', kind: 'duplicate', partOfOrder: false,
          dup: { requestIds: [idA, idB], dates: [a.requestDate ?? '', b.requestDate ?? ''], similarity: round(sim, 3), items: n, total: round(totalB) },
          reason: `Two requests from this hostel for ${m} are ${Math.round(sim * 100)}% the same across ${n} items. One may have been raised twice by mistake.`,
        });
      }
    }
  }

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
  // What is typical, learned from the data itself (nothing here is hardcoded per item):
  //  - itemTypical: the usual size of an order for each item (sets the noise floor)
  //  - hostelRate: each hostel's own typical per-student rate for each item (median over its months)
  const posByItem = new Map<string, number[]>();
  const monthRates = new Map<string, Map<string, { students: number; rates: number[] }>>();    // item -> hostelKey -> rates
  for (const [k, e] of agg) {
    const [g, h] = k.split('|');
    const st = sizes.get(`${g}|${h}`);
    for (const [it, q] of Object.entries(e.items)) {
      if (q <= 0) continue;
      (posByItem.get(it) ?? posByItem.set(it, []).get(it)!).push(q);
      if (st && st > 0) {
        const m = monthRates.get(it) ?? monthRates.set(it, new Map()).get(it)!;
        const x = m.get(`${g}|${h}`) ?? m.set(`${g}|${h}`, { students: st, rates: [] }).get(`${g}|${h}`)!;
        x.rates.push(q / st);
      }
    }
  }
  const itemTypical = new Map([...posByItem].map(([it, v]) => [it, median(v)]));
  const hostelRate = new Map([...monthRates].map(([it, m]) => [it, [...m].map(([hk, x]) => ({ hostel: hk.split('|')[1]!, godown: Number(hk.split('|')[0]), students: x.students, rate: median(x.rates) }))]));
  const unitOf = (item: string) => { const m = /\[unit:([^;\]]*)/.exec(item); const u = m ? decodeURIComponent(m[1]!).toLowerCase().trim() : ''; return u === 'unknown' ? '' : u; };
  const unitFloor = (item: string) => cfg.minExcessUnits[unitOf(item)] ?? cfg.minExcessOther;
  const floorOf = (item: string) => cfg.itemMinExcess[item] ?? Math.max(cfg.minExcess, unitFloor(item), cfg.floorFrac * (itemTypical.get(item) ?? 0));
  /** robust centre and spread of ln(values) */
  const logStats = (vals: number[]) => {
    const l = vals.filter((v) => v > 0).map(Math.log), m = median(l);
    return { m, mad: Math.max(cfg.madFloor, 1.4826 * median(l.map((x) => Math.abs(x - m)))) };
  };

  // Two-way robust fit (median polish): item effect = what a typical hostel asks per student for the item,
  // hostel effect = how much more or less than typical this hostel asks across all its items. The leftover spread per item
  // (after removing the hostel effect) is much tighter than the raw spread, so smaller jumps stand out.
  const logMed = new Map<string, number>();
  for (const [it, list] of hostelRate) logMed.set(it, median(list.map((p) => Math.log(p.rate))));
  const hostelOff = new Map<string, number>();
  { const per = new Map<string, number[]>();
    for (const [it, list] of hostelRate) for (const p of list) (per.get(`${p.godown}|${p.hostel}`) ?? per.set(`${p.godown}|${p.hostel}`, []).get(`${p.godown}|${p.hostel}`)!).push(Math.log(p.rate) - logMed.get(it)!);
    for (const [k, v] of per) if (v.length >= cfg.minItemsForScale) hostelOff.set(k, median(v)); }
  const resSigma = new Map<string, number>();
  for (const [it, list] of hostelRate) {
    const res = list.map((p) => Math.log(p.rate) - logMed.get(it)! - (hostelOff.get(`${p.godown}|${p.hostel}`) ?? 0));
    const m = median(res);
    resSigma.set(it, Math.max(cfg.madFloor, 1.4826 * median(res.map((x) => Math.abs(x - m)))));
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
      const kindVals = new Map<string, Map<string, number[]>>();            // society (kind of hostel) -> item -> quantities
      for (const [, e] of cur) {
        const soc = e.meta.societyId ?? '';
        const km = kindVals.get(soc) ?? kindVals.set(soc, new Map()).get(soc)!;
        for (const [it, q] of Object.entries(e.items)) if (q > 0) {
          (peerVals.get(it) ?? peerVals.set(it, []).get(it)!).push(q);
          (km.get(it) ?? km.set(it, []).get(it)!).push(q);
        }
      }
      const peerMed = new Map([...peerVals].map(([it, v]) => [it, v.length >= cfg.minPeers ? median(v) : 0]));
      /** Hostels of the same kind (same society) when there are enough of them, otherwise everyone. */
      const poolFor = (soc: string, item: string) => { const k = cfg.peersByKind ? kindVals.get(soc)?.get(item) : undefined; return k && k.length >= cfg.minPeers ? k : peerVals.get(item); };
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
        const soc = e.meta.societyId ?? '';
        const medOf = (it: string) => { const v = poolFor(soc, it); return v && v.length >= cfg.minPeers ? median(v) : 0; };
        const ratios = Object.entries(e.items).filter(([it, q]) => q > 0 && medOf(it) > 0).map(([it, q]) => q / medOf(it));
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
            const all = (hostelRate.get(item) ?? []).filter((p) => p.hostel !== hostel && p.godown === gid);
            // Close in size first. If too few are close, widen to the nearest hostels of any size (rates are per student, so this is still fair).
            const byCloseness = [...all].sort((a, b) => Math.abs(Math.log(a.students / students)) - Math.abs(Math.log(b.students / students)));
            const near = byCloseness.filter((p) => p.students >= students / cfg.sizeBand && p.students <= students * cfg.sizeBand);
            const use = (near.length >= cfg.minPeers ? near : byCloseness).slice(0, cfg.peerK);
            if (use.length >= cfg.minPeers) {
              const rates = use.map((p) => p.rate), sz = use.map((p) => p.students), ls = logStats(rates);
              return { expected: median(rates) * students, low: quantile(rates, 0.25) * students, high: quantile(rates, 0.75) * students,
                count: use.length, basis: 'students' as const, sizeRange: [Math.min(...sz), Math.max(...sz)] as [number, number],
                z: (qty: number) => (Math.log(qty / students) - ls.m) / ls.mad };
            }
          }
          const v = poolFor(soc, item), pmed = medOf(item);
          if (!v || v.length < cfg.minPeers || scale <= 0 || !pmed) return undefined;
          const ls = logStats(v);
          return { expected: pmed * scale, low: quantile(v, 0.25) * scale, high: quantile(v, 0.75) * scale, count: v.length, basis: 'estimated' as const, sizeRange: undefined,
            z: (qty: number) => (Math.log(qty / scale) - ls.m) / ls.mad };
        };
        const peerStat = (item: string): Candidate['peer'] => {
          const p = peerInfo(item);
          return p && { count: p.count, low: round(p.low), high: round(p.high), typical: round(p.expected), basis: p.basis, ...(p.sizeRange ? { sizeRange: p.sizeRange } : {}) };
        };
        const expectation = new Map<string, { expected: number; method: 'own-history' | 'peers' }>();
        const found = new Map<string, Candidate>();
        // how far above/below typical this hostel asks, per item (students known only); used to judge each item against the hostel's own level
        const logRatio = new Map<string, number>();
        if ((cfg.hostelEffect || cfg.hostelEffectRating) && students) for (const [it, q] of Object.entries(e.items)) {
          const pi = q > 0 ? peerInfo(it) : undefined;
          if (pi && pi.basis === 'students' && pi.expected > 0) logRatio.set(it, Math.log(q / pi.expected));
        }
        const levelWithout = (it: string): number | null => {
          const v = [...logRatio].filter(([k]) => k !== it).map(([, x]) => x);
          return v.length >= cfg.minItemsForScale ? Math.max(-1.5, Math.min(1.5, median(v))) : null;
        };

        for (const [item, qty] of Object.entries(e.items)) {
          if (qty <= 0) continue;
          const minExcess = floorOf(item);
          const past = hist.map(([, h]) => h.items[item] ?? 0).filter((q) => q > 0);   // zeros are not "usual need"
          const pInfo = peerInfo(item);
          const peerZ = pInfo ? pInfo.z(qty) : -Infinity;
          let method = null as 'own-history' | 'peers' | 'blend' | null;
          let expected = 0;

          if (past.length >= cfg.ownMinHistory) { method = 'own-history'; expected = median(past); }
          else if (pInfo && pInfo.expected > 0) { method = 'peers'; expected = pInfo.expected; }
          if (!method || expected <= 0) continue;
          expectation.set(item, { expected, method: method === 'blend' ? 'peers' : method });

          let flagged: boolean;
          let zUsed = peerZ;
          if (method === 'own-history') {
            // lower the bar when similar hostels also say it is high; raise it when this hostel's own months already swing a lot
            const volatile = Math.max(...past) / Math.min(...past) >= 2.5;
            const limit = volatile ? cfg.ownVolatile : peerZ >= 2.5 ? cfg.ownCorroborated : cfg.ownRatio;
            flagged = qty >= limit * expected && qty - expected >= minExcess && (!cfg.ownAbovePeers || !pInfo || qty > pInfo.high);
          } else {
            flagged = qty >= cfg.peerRatio * expected && peerZ >= cfg.peerZ && qty - expected >= minExcess;
          }
          // Own months say "normal" but similar hostels clearly disagree AND this is at least 1.5x anything this hostel has asked
          // before: trust both signals together (a hostel with only a couple of months of history can look more volatile than it is).
          if (!flagged && method === 'own-history' && pInfo && pInfo.expected > 0 && qty >= cfg.peerRatio * pInfo.expected
              && peerZ >= cfg.peerZ && qty >= 1.5 * Math.max(...past) && qty - pInfo.expected >= minExcess) {
            flagged = true; method = 'blend'; expected = pInfo.expected;
          }
          // Judge the item against this hostel's own level (learned from its other items). Catches smaller jumps at hostels that
          // normally ask for less than their peers, and avoids flagging single items at hostels that always ask for a lot.
          if (!flagged && cfg.hostelEffect && pInfo && pInfo.basis === 'students' && pInfo.expected > 0) {
            const lvl = levelWithout(item);
            if (lvl !== null) {
              const expAdj = pInfo.expected * Math.exp(lvl), zAdj = Math.log(qty / expAdj) / (resSigma.get(item) ?? cfg.madFloor);
              if (qty >= cfg.peerRatio * expAdj && zAdj >= cfg.peerZ && qty - expAdj >= minExcess && qty >= pInfo.expected) {
                flagged = true; method = method === 'own-history' ? 'blend' : 'peers'; expected = expAdj; zUsed = zAdj;
              }
            }
          }
          if (!flagged) continue;
          // A hostel asking for about what it asked in ANY other month (earlier or later) is behaving normally, whatever similar hostels do.
          {
            let othersMax = 0;
            for (const [k, o] of agg) { const parts = k.split('|'); if (parts[0] === String(gid) && parts[1] === hostel && parts[2] !== month) othersMax = Math.max(othersMax, o.items[item] ?? 0); }
            if (othersMax > 0 && qty <= cfg.ownConsistency * othersMax) continue;
          }
          // Rate it against the hostel's own level too: the leftover spread is tighter, so a real jump scores higher than the raw comparison says.
          if (cfg.hostelEffectRating && method !== 'own-history' && pInfo && pInfo.basis === 'students' && pInfo.expected > 0) {
            const lvl = levelWithout(item);
            if (lvl !== null && qty >= pInfo.expected) zUsed = Math.max(zUsed, Math.log(qty / (pInfo.expected * Math.exp(lvl))) / (resSigma.get(item) ?? cfg.madFloor));
          }
          let reason = method === 'own-history' || method === 'blend'
            ? `Asked ${qty} but this hostel usually asks ~${round(expected)} (last ${past.length} months: ${past.join(', ')})`
            : `Asked ${qty}; hostels like it ask ~${round(expected)}` + (past.length ? ` (this hostel's only earlier request: ${past[0]})` : ' (no earlier history for this hostel)');
          if (method === 'own-history' && pInfo) reason += `; other hostels like it ask ~${round(pInfo.expected)}`;
          const ratio = qty / expected;
          const rated = severity(ratio, method, zUsed, !!pInfo && qty <= pInfo.high);
          if (cfg.dropMinor && rated === 'low' && method !== 'own-history') continue;     // a jump over the hostel's own history is solid evidence; a weak peer-only note is not
          found.set(item, {
            key: `${gid}|${hostel}|${month}|${stableItemName(item)}`, godownId: gid, hostelCode: hostel,
            hostelName: e.meta.hostelName, districtName: e.meta.districtName, month, item,
            requested: round(qty), expected: round(expected), ratio: round(ratio, 1), score: round(Math.log2(ratio), 2),
            severity: rated, method, kind: 'spike', partOfOrder: false, looksLikeExtraZero: false, peer: peerStat(item), ...(students ? { students } : {}), reason,
          });
          const c = found.get(item)!;
          for (const div of [10, 100, 1000]) {
            const fix = qty / div;
            const inOwn = past.length >= cfg.ownMinHistory && fix >= 0.6 * Math.min(...past) && fix <= 1.6 * Math.max(...past);
            const inPeer = method === 'peers' && pInfo && fix >= 0.7 * pInfo.low && fix <= 1.4 * pInfo.high;
            if (inOwn || inPeer || (ratio >= div * 0.85 && ratio <= div * 1.15)) { c.looksLikeExtraZero = true; c.zeroFix = { divisor: div, value: round(fix) }; break; }
          }
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
              return x && value >= cfg.slipRatio * x.expected && value - x.expected >= floorOf(it);
            });
            const count = new Set(over.map(baseName)).size;
            if (count < cfg.slipMinGroup || count < cfg.slipFraction * new Set(names.map(baseName)).size) continue;
            for (const it of over) {
              const x = expectation.get(it)!;
              const qty = e.items[it]!;
              const ratio = qty / x.expected;
              const base = found.get(it);
              found.set(it, {
                ...(base ?? {
                  key: `${gid}|${hostel}|${month}|${stableItemName(it)}`, godownId: gid, hostelCode: hostel,
                  hostelName: e.meta.hostelName, districtName: e.meta.districtName, month, item: it,
                  requested: round(qty), expected: round(x.expected), ratio: round(ratio, 1), score: round(Math.log2(ratio), 2),
                  method: x.method, peer: peerStat(it), ...(students ? { students } : {}), reason: '',
                }),
                severity: 'high', kind: 'typing', slip: { value, count, items: over },
                looksLikeExtraZero: false,
                reason: `The same number (${value}) was entered for ${count} different items, far above what is usual for each. Likely a typing mistake.`,
              });
            }
          }
        }
        /** The whole-order measure for every month this hostel has requests in, so the screen can show its earlier months. */
        const orderHistory = () => {
          const out: { month: string; ratio: number }[] = [];
          for (const [k, mo] of agg) {
            if (!k.startsWith(`${gid}|${hostel}|`)) continue;
            const rs: number[] = [];
            for (const [item, q] of Object.entries(mo.items)) {
              const pi = q > 0 ? peerInfo(item) : undefined;
              if (pi && pi.basis === 'students' && pi.expected > 0) rs.push(q / pi.expected);
            }
            if (rs.length >= cfg.orderMinItems) out.push({ month: k.split('|')[2]!, ratio: round(median(rs), 1) });
          }
          return out.sort((a, b) => a.month.localeCompare(b.month));
        };
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
                order: { itemsCompared: ratiosOrder.length, history: orderHistory() }, students,
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
  out.push(...dupFlags);
  // Two different variants of one item in the same month (e.g. the same name in kg and in packets) must not share a flag.
  const seen = new Map<string, number>();
  for (const f of out) seen.set(f.key, (seen.get(f.key) ?? 0) + 1);
  for (const f of out) if (seen.get(f.key)! > 1 && f.kind !== 'duplicate' && f.kind !== 'order') f.key = `${f.godownId}|${f.hostelCode}|${f.month}|${f.item}`;
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
  const reqs = await c.requests.find({}, { projection: { items: 1, itemSnapshots: 1, godownId: 1, hostelCode: 1, hostelName: 1, districtName: 1, month: 1, status: 1, societyId: 1, requestId: 1, requestDate: 1 } }).toArray();
  const sizes = new Map((await c.hostels.find({ students: { $gt: 0 } }).toArray()).map((h) => [`${h.godownId}|${h.hostelCode}`, h.students!] as const));
  // Flags from older months stay open until someone decides, so they must be re-checked too: if the request was rejected or changed
  // since, the flag goes away instead of showing old numbers forever.
  const openMonths = (await c.anomalies.distinct('month', { status: 'open' })) as string[];
  evalMonths = [...new Set([...evalMonths, ...openMonths])];
  const found = detectAnomalies(reqs, evalMonths, cfg, sizes);
  const now = new Date();

  // Flags saved under an older key (before flags were identified by their plain item name) are carried over: the same flag keeps
  // its review decision and is listed under its new key in any issue that referenced the old one.
  const identity = (x: { godownId: number; hostelCode: string; month: string; item: string; kind: string }) => `${x.godownId}|${x.hostelCode}|${x.month}|${x.kind}|${stableItemName(x.item)}`;
  const existing = await c.anomalies.find({ status: { $ne: 'resolved' }, month: { $in: evalMonths } }, { projection: { key: 1, godownId: 1, hostelCode: 1, month: 1, item: 1, kind: 1, status: 1 } }).toArray();
  const byIdentity = new Map(existing.filter((e) => e.kind !== 'duplicate').map((e) => [identity(e), e] as const));
  let created = 0;
  for (const a of found) {
    const old = a.kind === 'duplicate' ? undefined : byIdentity.get(identity(a));
    const carry = old && old.key !== a.key ? old : undefined;
    const r = await c.anomalies.updateOne({ key: a.key }, {
      $set: { ...a, lastSeenAt: now, updatedAt: now },
      $setOnInsert: { status: carry && carry.status !== 'open' ? carry.status : 'open', detectedAt: now },
    }, { upsert: true });
    if (r.upsertedCount) created++;
    if (carry) {
      await c.anomalies.updateOne({ key: carry.key }, { $set: { status: 'resolved', supersededBy: a.key, updatedAt: now } });
      await c.issues.updateMany({ anomalyKeys: carry.key }, { $addToSet: { anomalyKeys: a.key } });
      await c.issues.updateMany({ anomalyKeys: carry.key }, { $pull: { anomalyKeys: carry.key } });
    }
  }
  // A flag that disappeared was marked "resolved". If it is found again it must come back to the list; otherwise it stays
  // hidden for good. (Anything a person decided - wrong, fine, normal - is left exactly as they set it.)
  if (found.length) await c.anomalies.updateMany({ key: { $in: found.map((f) => f.key) }, status: 'resolved' }, { $set: { status: 'open', updatedAt: now } });
  // mark open ones that are no longer flagged as resolved
  await c.anomalies.updateMany(
    { status: 'open', month: { $in: evalMonths }, key: { $nin: found.map((f) => f.key) } },
    { $set: { status: 'resolved', updatedAt: now } },
  );
  return { found: found.length, created };
}
