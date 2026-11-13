/**
 * Detector benchmark. Plants known mistakes into the real data and measures how many are caught,
 * how many false alarms normal-sized noise causes, and how many requests cannot be judged at all.
 * Usage: npm run worker -- bench
 */
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { detectAnomalies, DEFAULT_CONFIG, stableItemName, type Collections, type DetectorConfig, type RequestDoc } from '@anomaly/core';

const MONTH = '2026-11';
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : 'n/a').padStart(5);
const clone = (r: RequestDoc): RequestDoc => ({ ...r, items: { ...r.items } });

export interface BenchMetrics { recall: Record<number, number>; realRecall: Record<number, number>; medHigh: Record<number, number>; zero: number; typing: number; order: number; orderNoSize: number; rejectedCaught: number; noiseNew: number; noiseNewMH: number; flags: number; lowFlags: number }

export async function runBench(c: Collections, cfg: DetectorConfig = DEFAULT_CONFIG, opts: { quiet?: boolean; blind?: boolean } = {}): Promise<BenchMetrics> {
  const log = opts.quiet ? (..._a: unknown[]) => {} : console.log;
  if (process.env.BENCH_CFG) cfg = { ...cfg, ...JSON.parse(process.env.BENCH_CFG) };   // e.g. BENCH_CFG='{"estimatedOnlyRatio":6}' to try a setting
  const all = (await c.requests.find({}).toArray()).map(clone);
  const sizes = new Map((await c.hostels.find({ students: { $gt: 0 } }).toArray()).map((h) => [`${h.godownId}|${h.hostelCode}`, h.students!] as const));
  // BENCH_NOSIZES=1 pretends no hostel has a student count (the situation for the hostels the portal has no data for)
  const detectSizes = process.env.BENCH_NOSIZES ? new Map<string, number>() : sizes;
  if (process.env.BENCH_KIND === '0') cfg = { ...cfg, peersByKind: false };
  if (process.env.BENCH_HE === '1') cfg = { ...cfg, hostelEffect: true };
  if (process.env.BENCH_HE === 'rate') cfg = { ...cfg, hostelEffectRating: true };
  const run = (reqs: RequestDoc[]) => detectAnomalies(reqs, [MONTH], cfg, detectSizes);
  /** Runs many independent detections at once on every CPU core (BENCH_THREADS=1 turns this off). */
  const runMany = async (sets: RequestDoc[][]): Promise<ReturnType<typeof run>[]> => {
    const n = Math.min(Number(process.env.BENCH_THREADS ?? os.availableParallelism()), sets.length);
    if (n <= 1) return sets.map(run);
    const workers = Array.from({ length: n }, () => new Worker(new URL('./benchWorker.ts', import.meta.url), { workerData: { cfg, sizes: [...detectSizes], month: MONTH }, execArgv: process.execArgv }));
    const results: ReturnType<typeof run>[] = new Array(sets.length);
    let next = 0, done = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        const feed = (w: Worker) => { if (next < sets.length) { const id = next++; w.postMessage({ id, reqs: sets[id] }); } };
        for (const w of workers) {
          w.on('message', ({ id, out }: { id: number; out: ReturnType<typeof run> }) => { results[id] = out; if (++done === sets.length) resolve(); else feed(w); });
          w.on('error', reject);
          feed(w);
        }
      });
    } finally { await Promise.all(workers.map((w) => w.terminate())); }
    return results;
  };
  const live = (r: RequestDoc) => !/^reject/i.test(r.status);
  const nov = all.filter((r) => r.month === MONTH && live(r));
  const key = (a: { hostelCode: string; item: string }) => `${a.hostelCode}|${stableItemName(a.item)}`;

  // ---------- 0. baseline on the real data
  const base = run(all);
  const baseKeys = new Set(base.map(key));
  const cells = nov.reduce((s, r) => s + Object.values(r.items).filter((q) => q > 0).length, 0);
  const hostelsN = new Set(nov.map((r) => r.hostelCode)).size;
  log(`\nREAL DATA (${MONTH}): ${hostelsN} hostels, ${cells} requested items`);
  const by = (f: (a: (typeof base)[number]) => string) => { const m: Record<string, number> = {}; for (const a of base) m[f(a)] = (m[f(a)] ?? 0) + 1; return JSON.stringify(m); };
  log(`  flags: ${base.length}  by kind ${by((a) => a.kind)}  by severity ${by((a) => a.severity)}`);

  // ---------- 1. blind spots: requested items the detector cannot judge at all
  const judged = new Set<string>();
  if (opts.blind !== false) {
    // an item is judgeable if flagging it would be possible: plant an absurd value and see if it is caught
    const probe = all.map(clone);
    const picked: { r: RequestDoc; item: string }[] = [];
    for (const r of probe.filter((x) => x.month === MONTH && live(x))) for (const it of Object.keys(r.items)) if (r.items[it]! > 0) picked.push({ r, item: it });
    // plant in batches: one item per hostel, and each item in at most 3 hostels at once, so the planted values
    // do not disturb each other or the "normal" the detector learns for that item from its peers
    const batches: typeof picked[] = [];
    const usedH: Set<string>[] = [], itemN: Map<string, number>[] = [];
    for (const p of picked) {
      const name = stableItemName(p.item);
      let i = 0;
      while (i < batches.length && (usedH[i]!.has(p.r.hostelCode) || (itemN[i]!.get(name) ?? 0) >= 3)) i++;
      if (i === batches.length) { batches.push([]); usedH.push(new Set()); itemN.push(new Map()); }
      batches[i]!.push(p); usedH[i]!.add(p.r.hostelCode); itemN[i]!.set(name, (itemN[i]!.get(name) ?? 0) + 1);
    }
    const tests = batches.map((batch) => {
      const test = all.map(clone);
      for (const p of batch) { const t = test.find((x) => x.requestId === p.r.requestId && x.godownId === p.r.godownId)!; t.items[p.item] = Math.max(t.items[p.item]! * 1000, 1000); }
      return test;
    });
    const outs = await runMany(tests);
    batches.forEach((batch, i) => {
      const got = new Set(outs[i]!.filter((a) => a.requested >= 1000 || a.kind !== 'spike').map(key));
      for (const p of batch) if (got.has(`${p.r.hostelCode}|${stableItemName(p.item)}`)) judged.add(`${p.r.hostelCode}|${stableItemName(p.item)}`);
    });
    const uniq = new Set(picked.map((p) => `${p.r.hostelCode}|${stableItemName(p.item)}`));
    log(`\nBLIND SPOTS: hostel+item combinations the detector can judge: ${judged.size}/${uniq.size} (${pct(judged.size, uniq.size)}); cannot judge: ${uniq.size - judged.size}`);
    // why can't they be judged?
    const hostelsPerItem = new Map<string, Set<string>>();
    for (const p of picked) (hostelsPerItem.get(p.item) ?? hostelsPerItem.set(p.item, new Set()).get(p.item)!).add(p.r.hostelCode);
    const why: Record<string, number> = {};
    for (const p of [...new Map(picked.map((q) => [`${q.r.hostelCode}|${stableItemName(q.item)}`, q])).values()]) {
      if (judged.has(`${p.r.hostelCode}|${stableItemName(p.item)}`)) continue;
      const hasSize = sizes.has(`${p.r.godownId}|${p.r.hostelCode}`);
      const n = hostelsPerItem.get(p.item)!.size;
      const k = `${hasSize ? 'has student count' : 'NO student count'}, item ordered by ${n >= 30 ? '30+' : n >= 12 ? '12-29' : n >= 6 ? '6-11' : '<6'} hostels`;
      why[k] = (why[k] ?? 0) + 1;
    }
    for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) log(`    cannot judge: ${String(v).padStart(4)}  ${k}`);
    // BENCH_DUMP=<file> saves the list of items that cannot be judged, so the reasons can be studied
    if (process.env.BENCH_DUMP) {
      const rows = [...new Map(picked.map((q) => [`${q.r.hostelCode}|${stableItemName(q.item)}`, q])).values()]
        .filter((p) => !judged.has(`${p.r.hostelCode}|${stableItemName(p.item)}`))
        .map((p) => ({ hostel: p.r.hostelCode, item: p.item, qty: p.r.items[p.item], students: sizes.get(`${p.r.godownId}|${p.r.hostelCode}`) ?? null, hostelsOrderingItem: hostelsPerItem.get(p.item)!.size }));
      (await import('node:fs')).writeFileSync(process.env.BENCH_DUMP, JSON.stringify(rows, null, 1));
    }
  }

  // ---------- 2. recall on planted mistakes (3 random plantings, results added together)
  const medianOf = (a: number[]) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[v.length >> 1]! : 0; };
  const rateByItem = new Map<string, { h: string; rate: number }[]>(); const typical = new Map<string, number>();
  { const q: Record<string, number[]> = {};
    for (const r of nov) { const st = sizes.get(`${r.godownId}|${r.hostelCode}`); for (const [it, v] of Object.entries(r.items)) { if (v <= 0) continue; (q[it] ??= []).push(v); if (st) (rateByItem.get(it) ?? rateByItem.set(it, []).get(it)!).push({ h: r.hostelCode, rate: v / st }); } }
    for (const [it, v] of Object.entries(q)) typical.set(it, medianOf(v)); }
  /** What a hostel of this size would normally ask for the item, according to the clean data. */
  const normalFor = (h: string, item: string) => { const st = sizes.get(`2|${h}`) ?? 0; const rs = (rateByItem.get(item) ?? []).filter((x) => x.h !== h).map((x) => x.rate); return rs.length >= 5 && st ? medianOf(rs) * st : 0; };
  type Tally = { real: number; realHit: number; n: number; hit: number; hist: number; histHit: number; noHist: number; noHistHit: number; medHigh: number; tagged: number };
  const T = (): Tally => ({ real: 0, realHit: 0, n: 0, hit: 0, hist: 0, histHit: 0, noHist: 0, noHistHit: 0, medHigh: 0, tagged: 0 });
  const spikeT: Record<number, Tally> = { 2: T(), 3: T(), 5: T(), 10: T(), 30: T() };
  const zeroT = T(); let typeN = 0, typeHit = 0, orderN = 0, orderHit = 0, orderReal = 0, orderRealHit = 0, zeroFixOk = 0;
  const hasHist = (h: string) => new Set(all.filter((r) => r.hostelCode === h && r.month < MONTH && live(r)).map((r) => r.month)).size >= 2;

  for (const seed of [7, 8, 9]) {
    const R = rng(seed);
    const pickFrom = <T,>(a: T[], n: number) => { const c = [...a]; const o: T[] = []; while (o.length < n && c.length) o.push(c.splice(Math.floor(R() * c.length), 1)[0]!); return o; };
    const pool = pickFrom([...new Set(nov.filter((r) => sizes.has(`${r.godownId}|${r.hostelCode}`)).map((r) => r.hostelCode))], 400);
    let cursor = 0; const take = (n: number) => { const out = pool.slice(cursor, cursor + n); cursor += n; return out; };
    const test = all.map(clone);
    const novOf = (h: string) => test.find((r) => r.month === MONTH && r.hostelCode === h && live(r))!;
    const planted: { kind: string; mag: number; h: string; item: string; hist: boolean; orig: number }[] = [];
    for (const mag of [2, 3, 5, 10, 30]) for (const h of take(12)) {
      const r = novOf(h); const items = Object.keys(r.items).filter((i) => r.items[i]! > 0); if (!items.length) continue;
      const item = items[Math.floor(R() * items.length)]!; planted.push({ kind: 'spike', mag, h, item, hist: hasHist(h), orig: r.items[item]! }); r.items[item] = r.items[item]! * mag;
    }
    for (const h of take(12)) {
      const r = novOf(h); const items = Object.keys(r.items).filter((i) => r.items[i]! >= 10); if (!items.length) continue;
      const item = items[Math.floor(R() * items.length)]!; planted.push({ kind: 'zero', mag: 10, h, item, hist: hasHist(h), orig: r.items[item]! }); r.items[item] = r.items[item]! * 10;
    }
    const typed: { h: string; items: string[] }[] = [];
    for (const h of take(14)) { const r = novOf(h); const items = pickFrom(Object.keys(r.items).filter((i) => r.items[i]! > 0), 5); if (items.length < 5) continue; const v = Math.round(30 * Math.max(...items.map((i) => typical.get(i) ?? 1))); items.forEach((i) => (r.items[i] = v)); typed.push({ h, items }); }
    const orders: string[] = [];
    for (const h of take(14)) { const r = novOf(h); for (const i of Object.keys(r.items)) r.items[i] = r.items[i]! * 4; orders.push(h); }

    const found = run(test); const fk = new Map(found.map((a) => [key(a), a]));
    for (const p of planted) {
      const t = p.kind === 'zero' ? zeroT : spikeT[p.mag]!; const f = fk.get(`${p.h}|${stableItemName(p.item)}`);
      t.n++; p.hist ? t.hist++ : t.noHist++;
      const nf = normalFor(p.h, p.item); const trulyAbnormal = nf > 0 && p.orig * p.mag >= 3 * nf;
      if (trulyAbnormal) { t.real++; if (f) t.realHit++; }
      if (process.env.BENCH_DEBUG && p.kind === 'spike' && trulyAbnormal && !f) {
        const past = all.filter((r) => r.hostelCode === p.h && r.month < MONTH && live(r)).map((r) => r.items[p.item] ?? 0);
        console.log(`  MISSED (truly abnormal) x${p.mag}: ${p.item.slice(0, 22).padEnd(22)} planted ${(p.orig * p.mag).toFixed(1)} vs normal-for-size ${nf.toFixed(2)} (${((p.orig * p.mag) / nf).toFixed(1)}x) | earlier months [${past.join(', ')}] | students ${sizes.get(`2|${p.h}`) ?? '?'} | item ordered by ${(rateByItem.get(p.item) ?? []).length} hostels`);
      }
      if (process.env.BENCH_DEBUG && p.kind === 'spike' && p.mag === 5 && !f) {
        const past = all.filter((r) => r.hostelCode === p.h && r.month < MONTH && live(r)).map((r) => r.items[p.item] ?? 0);
        const med = (a: number[]) => { const v = [...a].filter((x) => x > 0).sort((x, y) => x - y); return v.length ? v[v.length >> 1]! : 0; };
        console.log(`  MISSED x5: ${p.item.slice(0, 24).padEnd(24)} planted ${(p.orig * 5).toFixed(1)} (was ${p.orig}) | own earlier months [${past.join(', ')}] median ${med(past)} | students ${sizes.get(`2|${p.h}`) ?? '?'}`);
      }
      if (f) { t.hit++; p.hist ? t.histHit++ : t.noHistHit++; if (f.severity !== 'low') t.medHigh++; if (f.looksLikeExtraZero) t.tagged++; if (p.kind === 'zero' && f.zeroFix && Math.abs(f.zeroFix.value - p.orig) / p.orig < 0.6) zeroFixOk++; }
    }
    typeN += typed.length; typeHit += typed.filter((t) => t.items.filter((i) => fk.get(`${t.h}|${stableItemName(i)}`)?.kind === 'typing').length >= 3).length;
    // a whole-order plant only counts when the planted order really is far above normal for the hostel's size
    const orderOracle = (h: string) => { const r = all.find((x) => x.month === MONTH && x.hostelCode === h && live(x))!; const ratios = Object.entries(r.items).filter(([, v]) => v > 0).map(([it, v]) => { const nf = normalFor(h, it); return nf > 0 ? (v * 4) / nf : 0; }).filter((x) => x > 0); return { median: medianOf(ratios), n: ratios.length }; };
    const real = orders.filter((h) => { const o = orderOracle(h); return o.n >= 8 && o.median >= 3; });
    orderN += orders.length; orderHit += orders.filter((h) => found.some((a) => a.hostelCode === h && a.kind === 'order')).length;
    orderReal += real.length; orderRealHit += real.filter((h) => found.some((a) => a.hostelCode === h && a.kind === 'order')).length;
    if (process.env.BENCH_DEBUG) for (const h of orders.filter((h) => !found.some((a) => a.hostelCode === h && a.kind === 'order'))) { const o = orderOracle(h); console.log(`  MISSED order: ${h} students ${sizes.get(`2|${h}`) ?? '?'} | items compared ${o.n} | planted order is ${o.median.toFixed(1)}x normal for its size`); }
  }
  log('\nRECALL ON PLANTED MISTAKES (caught / planted, 3 runs)');
  for (const mag of [2, 3, 5, 10, 30]) { const t = spikeT[mag]!;
    log(`  one item x${String(mag).padEnd(2)}   ${pct(t.hit, t.n)}  (${t.hit}/${t.n})   with own history ${pct(t.histHit, t.hist)}  without ${pct(t.noHistHit, t.noHist)}   medium/high ${pct(t.medHigh, t.n)}   | of those truly far above normal for the hostel's size: ${pct(t.realHit, t.real)} (${t.realHit}/${t.real})`); }
  log(`  extra zero (x10 on a staple)  ${pct(zeroT.hit, zeroT.n)}  (${zeroT.hit}/${zeroT.n})   explained as "a zero was typed" ${pct(zeroT.tagged, zeroT.hit)}   suggested value within range ${pct(zeroFixOk, zeroT.hit)}`);
  log(`  same number typed for 5 items  ${pct(typeHit, typeN)}  (${typeHit}/${typeN})   identified as a typing mistake`);
  log(`  whole order x4               ${pct(orderHit, orderN)}  (${orderHit}/${orderN})   | of those truly far above normal for the hostel's size (>=3x over 8+ items): ${pct(orderRealHit, orderReal)} (${orderRealHit}/${orderReal})`);

  // ---------- 2b. whole orders from hostels that have no trusted student count (the size-based whole-order check cannot run for them)
  const noSize = nov.filter((r) => (sizes.get(`${r.godownId}|${r.hostelCode}`) ?? 0) < cfg.minStudents).filter((r, i, a) => a.findIndex((x) => x.hostelCode === r.hostelCode) === i).slice(0, 24);
  const noSizeSets = noSize.map((r) => {
    const t = all.map(clone);
    const x = t.find((q) => q.requestId === r.requestId && q.godownId === r.godownId)!;
    for (const i of Object.keys(x.items)) x.items[i] = x.items[i]! * 4;
    return t;
  });
  const noSizeOut = await runMany(noSizeSets);
  const noSizeHit = noSize.filter((r, i) => noSizeOut[i]!.some((a) => a.hostelCode === r.hostelCode && a.kind === 'order')).length;
  log(`  whole order x4, hostels with no trusted student count  ${pct(noSizeHit, noSize.length)}  (${noSizeHit}/${noSize.length})`);

  // ---------- 2d. one inflated item: hostels WITH a trusted student count versus hostels WITHOUT one (BENCH_SPLIT=1; adds about a minute)
  if (process.env.BENCH_SPLIT) {
    const R3 = rng(7);
    const firstPerHostel = nov.filter((r, i, a) => a.findIndex((x) => x.hostelCode === r.hostelCode) === i);
    const sizeOf = (r: RequestDoc) => sizes.get(`${r.godownId}|${r.hostelCode}`) ?? 0;
    const groups: [string, RequestDoc[]][] = [
      ['with student count   ', firstPerHostel.filter((r) => sizeOf(r) >= cfg.minStudents).slice(0, 30)],
      ['without student count', firstPerHostel.filter((r) => sizeOf(r) < cfg.minStudents).slice(0, 30)],
    ];
    for (const mag of [5, 10]) for (const [label, group] of groups) {
      const planted = group.map((r) => { const items = Object.keys(r.items).filter((i) => r.items[i]! > 0); return { r, item: items[Math.floor(R3() * items.length)]! }; }).filter((p) => p.item);
      const sets = planted.map(({ r, item }) => { const t = all.map(clone); const x = t.find((q) => q.requestId === r.requestId && q.godownId === r.godownId)!; x.items[item] = x.items[item]! * mag; return t; });
      const outs = await runMany(sets);
      const hit = planted.filter(({ r, item }, i) => outs[i]!.some((a) => a.hostelCode === r.hostelCode && a.kind === 'spike' && stableItemName(a.item) === stableItemName(item))).length;
      log(`  one item x${String(mag).padEnd(2)}, hostels ${label}  ${pct(hit, planted.length)}  (${hit}/${planted.length})`);
    }
  }

  // ---------- 2c. real mistakes: requests the portal itself rejected (duplicates, quantity mistakes ...). Judged as they looked when raised.
  const rejected = all.filter((r) => /^reject/i.test(r.status));
  const asRaised = all.map((r) => (/^reject/i.test(r.status) ? { ...clone(r), status: 'Pending' } : clone(r)));
  const rejOut = detectAnomalies(asRaised, [...new Set(rejected.map((r) => r.month))], cfg, detectSizes);
  const rejCaught = rejected.filter((r) => rejOut.some((a) => a.hostelCode === r.hostelCode && a.month === r.month)).length;
  log(`  real mistakes the portal rejected   ${pct(rejCaught, rejected.length)}  (${rejCaught}/${rejected.length})   (hostel and month had at least one flag; a small sample that grows every month)`);

  // ---------- 3. false alarms from normal-sized noise (+-25%)
  const R2 = rng(99);
  const noisy = all.map(clone);
  for (const r of noisy) if (r.month === MONTH) for (const i of Object.keys(r.items)) if (r.items[i]! > 0) r.items[i] = Math.round(r.items[i]! * Math.exp((R2() - 0.5) * 0.5) * 100) / 100;
  const noisyFlags = run(noisy);
  const fresh = noisyFlags.filter((a) => !baseKeys.has(key(a)));
  log(`\nFALSE ALARMS FROM NORMAL NOISE (every request changed by up to +-25%)`);
  log(`  new flags that appeared: ${fresh.length} (${((1000 * fresh.length) / cells).toFixed(1)} per 1000 items) | flags that vanished: ${base.filter((a) => !new Set(noisyFlags.map(key)).has(key(a))).length}`);
  log(`  new flags by severity: ${JSON.stringify(fresh.reduce((m: Record<string, number>, a) => ((m[a.severity] = (m[a.severity] ?? 0) + 1), m), {}))}`);
  return {
    recall: Object.fromEntries([2, 3, 5, 10, 30].map((m) => [m, spikeT[m]!.hit / Math.max(1, spikeT[m]!.n)])) as Record<number, number>,
    realRecall: Object.fromEntries([2, 3, 5, 10, 30].map((m) => [m, spikeT[m]!.realHit / Math.max(1, spikeT[m]!.real)])) as Record<number, number>,
    medHigh: Object.fromEntries([2, 3, 5, 10, 30].map((m) => [m, spikeT[m]!.medHigh / Math.max(1, spikeT[m]!.n)])) as Record<number, number>,
    zero: zeroT.hit / Math.max(1, zeroT.n), typing: typeHit / Math.max(1, typeN), order: orderHit / Math.max(1, orderN), orderNoSize: noSizeHit / Math.max(1, noSize.length), rejectedCaught: rejCaught / Math.max(1, rejected.length),
    noiseNew: fresh.length, noiseNewMH: fresh.filter((a) => a.severity !== 'low').length, flags: base.length, lowFlags: base.filter((a) => a.severity === 'low').length,
  };
}
