import { describe, it, expect } from 'vitest';
import { detectAnomalies, DEFAULT_CONFIG } from './detector.js';

const BASE: Record<string, number> = { A: 100, B: 50, C: 20, D: 80, E: 10, F: 40, IddliRavva: 30 };
const mk = (hostel: string, month: string, items: Record<string, number>, status = 'Pending') => ({
  godownId: 2, hostelCode: hostel, hostelName: `${hostel}-X`, districtName: 'D', month, status,
  items: { ...BASE, ...items },
});
// 12 ordinary peer hostels for every month so peer medians exist
const peers = (month: string) => Array.from({ length: 12 }, (_, i) => mk(`P${i}`, month, { A: 100 + i, IddliRavva: 28 + (i % 5) }));
const world = (extra: ReturnType<typeof mk>[]) => [...peers('2026-09'), ...peers('2026-10'), ...peers('2026-11'), ...extra];
const find = (res: ReturnType<typeof detectAnomalies>, h: string, item = 'IddliRavva') => res.find((a) => a.hostelCode === h && a.item === item);

describe('detector', () => {
  it('flags 30,30 -> 300 using the hostel\'s own history (the headline case)', () => {
    const res = detectAnomalies(world([
      mk('H', '2026-09', {}), mk('H', '2026-10', {}), mk('H', '2026-11', { IddliRavva: 300 }),
    ]), ['2026-11']);
    const a = find(res, 'H')!;
    expect(a).toBeTruthy();
    expect(a.method).toBe('own-history');
    expect(a.severity).toBe('high');
    expect(a.expected).toBe(30);
    expect(a.ratio).toBe(10);
  });

  it('does not flag normal month-to-month variation', () => {
    const res = detectAnomalies(world([
      mk('H', '2026-09', { IddliRavva: 30 }), mk('H', '2026-10', { IddliRavva: 32 }), mk('H', '2026-11', { IddliRavva: 38 }),
    ]), ['2026-11']);
    expect(find(res, 'H')).toBeUndefined();
  });

  it('does not flag a hostel that always orders a lot', () => {
    const res = detectAnomalies(world([
      mk('H', '2026-09', { IddliRavva: 300 }), mk('H', '2026-10', { IddliRavva: 300 }), mk('H', '2026-11', { IddliRavva: 310 }),
    ]), ['2026-11']);
    expect(find(res, 'H')).toBeUndefined();
  });

  it('falls back to peers when the hostel has no history', () => {
    const res = detectAnomalies(world([mk('NEW', '2026-11', { IddliRavva: 300 })]), ['2026-11']);
    const a = find(res, 'NEW')!;
    expect(a?.method).toBe('peers');
    expect(a.severity).toBe('high');
  });

  it('does not flag a big hostel whose whole order is proportionally big', () => {
    const big = Object.fromEntries(Object.entries(BASE).map(([k, v]) => [k, v * 5]));
    const res = detectAnomalies(world([mk('BIG', '2026-11', big)]), ['2026-11']);
    expect(res.filter((a) => a.hostelCode === 'BIG')).toHaveLength(0);
  });

  it('ignores rejected requests', () => {
    const res = detectAnomalies(world([mk('R', '2026-11', { IddliRavva: 300 }, 'Rejected')]), ['2026-11']);
    expect(find(res, 'R')).toBeUndefined();
  });

  it('adds up several requests from the same hostel in one month', () => {
    const res = detectAnomalies(world([
      mk('H', '2026-09', {}), mk('H', '2026-10', {}),
      mk('H', '2026-11', { IddliRavva: 150 }), mk('H', '2026-11', { IddliRavva: 150 }),
    ]), ['2026-11']);
    expect(find(res, 'H')?.requested).toBe(300);
  });

  it('does not treat an item a hostel never ordered before as a spike against zero', () => {
    const res = detectAnomalies([
      ...world([]),
      mk('H', '2026-09', { Z: 0 }), mk('H', '2026-10', { Z: 0 }), mk('H', '2026-11', { Z: 40 }),
    ], ['2026-11']);
    expect(find(res, 'H', 'Z')).toBeUndefined();   // no peer data for Z, no own non-zero history
  });

  it('only rates a jump as minor when the amount is still normal for similar hostels', () => {
    const res = detectAnomalies(world([
      mk('H', '2026-09', { E: 1 }), mk('H', '2026-10', { E: 1 }), mk('H', '2026-11', { E: 4 }),
    ]), ['2026-11']);
    const a = find(res, 'H', 'E');           // 1 -> 4 is a jump for this hostel, but similar hostels ask for 10
    expect(a === undefined || a.severity === 'low').toBe(true);
  });
  it('learns the noise floor from the data instead of using a fixed number', () => {
    expect(DEFAULT_CONFIG.minExcess).toBeLessThan(1);
    expect(DEFAULT_CONFIG.floorFrac).toBeGreaterThan(0);
  });
});

describe('typing mistakes', () => {
  const SPICES = ['Clove', 'Cardamom', 'Cinnamon', 'Carom', 'Soda'];
  const spiceBase = Object.fromEntries(SPICES.map((s) => [s, 0.5]));
  const spicePeers = (m: string) => Array.from({ length: 12 }, (_, i) => mk(`P${i}`, m, spiceBase));
  const w = (extra: ReturnType<typeof mk>[]) => [...spicePeers('2026-09'), ...spicePeers('2026-10'), ...spicePeers('2026-11'), ...extra];

  it('flags the same big number typed for many items (the Kollapur case)', () => {
    const typed = Object.fromEntries(SPICES.map((s) => [s, 250]));
    const res = detectAnomalies(w([mk('K', '2026-09', spiceBase), mk('K', '2026-10', typed)]), ['2026-10']);
    const hits = res.filter((a) => a.hostelCode === 'K' && SPICES.includes(a.item));
    expect(hits).toHaveLength(5);
    expect(hits.every((a) => a.kind === 'typing' && a.severity === 'high')).toBe(true);
    expect(hits[0]!.slip).toMatchObject({ value: 250, count: 5 });
  });

  it('works with no history too (compared with similar hostels)', () => {
    const typed = Object.fromEntries(SPICES.map((s) => [s, 250]));
    const res = detectAnomalies(w([mk('NEW', '2026-11', typed)]), ['2026-11']);
    expect(res.filter((a) => a.hostelCode === 'NEW' && a.kind === 'typing')).toHaveLength(5);
  });

  it('does NOT flag a hostel that always orders the same round number for many items', () => {
    const round = Object.fromEntries(SPICES.map((s) => [s, 10]));
    const res = detectAnomalies(w([mk('R', '2026-09', round), mk('R', '2026-10', round), mk('R', '2026-11', round)]), ['2026-11']);
    expect(res.filter((a) => a.hostelCode === 'R')).toHaveLength(0);
  });

  it('does not call it a typing mistake when only two items share the number', () => {
    const two = { Clove: 250, Cardamom: 250, Cinnamon: 0.5, Carom: 0.5, Soda: 0.5 };
    const res = detectAnomalies(w([mk('T', '2026-09', spiceBase), mk('T', '2026-10', two)]), ['2026-10']);
    expect(res.filter((a) => a.hostelCode === 'T' && a.kind === 'typing')).toHaveLength(0);
  });

  it('explains a jump that a typed zero would explain, and says what the amount would be', () => {
    const base = [mk('H', '2026-09', {}), mk('H', '2026-10', {})];
    const a = find(detectAnomalies(world([...base, mk('H', '2026-11', { IddliRavva: 300 })]), ['2026-11']), 'H')!;
    expect(a.looksLikeExtraZero).toBe(true);
    expect(a.zeroFix).toEqual({ divisor: 10, value: 30 });
    const b = find(detectAnomalies(world([...base, mk('H', '2026-11', { IddliRavva: 3600 })]), ['2026-11']), 'H')!;
    expect(b.zeroFix?.divisor).toBe(100);                          // two zeros: 3600 -> 36
    const c = find(detectAnomalies(world([...base, mk('H', '2026-11', { IddliRavva: 95 })]), ['2026-11']), 'H');
    expect(c?.looksLikeExtraZero ?? false).toBe(false);           // 95 is not explained by a typed zero
  });
});

describe('similar-hostel comparison details', () => {
  it('records how many similar hostels were compared and their usual range', () => {
    const res = detectAnomalies(world([mk('NEW', '2026-11', { IddliRavva: 300 })]), ['2026-11']);
    const a = find(res, 'NEW')!;
    expect(a.peer).toBeDefined();
    expect(a.peer!.count).toBeGreaterThanOrEqual(12);
    expect(a.peer!.low).toBeLessThanOrEqual(a.peer!.typical);
    expect(a.peer!.typical).toBeLessThanOrEqual(a.peer!.high);
    expect(a.peer!.typical).toBeGreaterThan(20);
  });
  it('also gives the similar-hostel numbers when the hostel has its own history', () => {
    const res = detectAnomalies(world([mk('H', '2026-09', {}), mk('H', '2026-10', {}), mk('H', '2026-11', { IddliRavva: 300 })]), ['2026-11']);
    const a = find(res, 'H')!;
    expect(a.method).toBe('own-history');
    expect(a.peer?.count).toBeGreaterThan(0);
  });
});

describe('comparing per student (real hostel sizes)', () => {
  const rate = 0.5;                                     // everyone normally asks 0.5 per student
  const sizesMap = new Map<string, number>();
  const small = Array.from({ length: 10 }, (_, i) => 30 + i * 8);       // 30..102 students
  const big = Array.from({ length: 10 }, (_, i) => 300 + i * 60);       // 300..840 students
  const peerReqs = [...small, ...big].map((st, i) => { sizesMap.set(`2|S${i}`, st); return mk(`S${i}`, '2026-11', { Rice: rate * st }); });
  const only = (extra: ReturnType<typeof mk>[]) => [...peerReqs, ...extra].map((r) => ({ ...r, items: { Rice: r.items.Rice ?? 0 } }));
  const run = (hostel: string, students: number, qty: number) => {
    const m = new Map(sizesMap); m.set(`2|${hostel}`, students);
    return detectAnomalies(only([mk(hostel, '2026-11', { Rice: qty })]), ['2026-11'], DEFAULT_CONFIG, m).find((a) => a.hostelCode === hostel);
  };

  it('does not flag a big hostel that simply has many students', () => {
    expect(run('BIGGY', 600, 300)).toBeUndefined();               // 0.5 per student, same as everyone
  });
  it('does not flag a small hostel with a small order', () => {
    expect(run('TINY', 50, 25)).toBeUndefined();
  });
  it('flags a small hostel that asks for a big hostel\'s amount', () => {
    const a = run('TINY', 50, 300)!;                               // 6 per student: 12x normal
    expect(a).toBeTruthy();
    expect(a.peer?.basis).toBe('students');
    expect(a.students).toBe(50);
    expect(a.expected).toBeCloseTo(25, 0);                         // 0.5 x 50 students
  });
  it('compares only with hostels of a similar size and reports their size range', () => {
    const a = run('TINY', 50, 300)!;
    expect(a.peer!.sizeRange![0]).toBeGreaterThanOrEqual(25);
    expect(a.peer!.sizeRange![1]).toBeLessThanOrEqual(100);
  });
  it('says it is an estimate when the student count is unknown', () => {
    const a = detectAnomalies(world([mk('NEW', '2026-11', { IddliRavva: 300 })]), ['2026-11'])
      .find((x) => x.hostelCode === 'NEW')!;
    expect(a.peer?.basis).toBe('estimated');
    expect(a.students).toBeUndefined();
  });
});

describe('whole-order check', () => {
  const items = Array.from({ length: 12 }, (_, i) => `Item${i}`);
  const sizesMap = new Map<string, number>();
  const mkAll = (hostel: string, mult: number) => mk(hostel, '2026-11', Object.fromEntries(items.map((it) => [it, 10 * mult]))) ;
  const peers = Array.from({ length: 14 }, (_, i) => { sizesMap.set(`2|W${i}`, 100 + i); return { ...mk(`W${i}`, '2026-11', {}), items: Object.fromEntries(items.map((it) => [it, 10])) }; });
  const run = (mult: number) => {
    const m = new Map(sizesMap); m.set('2|X', 105);
    return detectAnomalies([...peers, { ...mkAll('X', mult), items: Object.fromEntries(items.map((it) => [it, 10 * mult])) }], ['2026-11'], DEFAULT_CONFIG, m).filter((a) => a.hostelCode === 'X');
  };
  it('reports ONE whole-order finding when every item is far above normal per student', () => {
    const res = run(6);
    const order = res.filter((a) => a.kind === 'order');
    expect(order).toHaveLength(1);
    expect(order[0]!.ratio).toBeGreaterThanOrEqual(5);
    expect(order[0]!.order!.itemsCompared).toBe(12);
  });
  it('reports nothing when the order is normal for the number of students', () => {
    expect(run(1)).toHaveLength(0);
  });
});

describe('hostels with no student count are compared with the same kind of hostel', () => {
  const items = ['I0', 'I1', 'I2', 'I3', 'I4', 'I5'];
  const make = (hostel: string, society: string, qty: number, i0 = qty) =>
    ({ ...mk(hostel, '2026-11', {}), societyId: society, items: Object.fromEntries(items.map((it, k) => [it, k === 0 ? i0 : qty])) });
  const kind = Array.from({ length: 10 }, (_, i) => make(`K${i}`, 'KG', 20));          // this kind of hostel asks ~20
  const others = Array.from({ length: 10 }, (_, i) => make(`G${i}`, 'GEN', 100));      // other hostels ask ~100
  it('flags an amount that is normal for other hostels but 5x what its own kind asks', () => {
    const res = detectAnomalies([...kind, ...others, make('X', 'KG', 20, 100)], ['2026-11']);
    expect(res.find((a) => a.hostelCode === 'X' && a.item === 'I0')).toBeTruthy();
  });
  it('does not flag a hostel that asks what its own kind normally asks', () => {
    const res = detectAnomalies([...kind, ...others, make('X', 'KG', 20)], ['2026-11']);
    expect(res.filter((a) => a.hostelCode === 'X')).toHaveLength(0);
  });
});
