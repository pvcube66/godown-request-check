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

  it('ignores tiny absolute differences', () => {
    const res = detectAnomalies(world([
      mk('H', '2026-09', { E: 1 }), mk('H', '2026-10', { E: 1 }), mk('H', '2026-11', { E: 4 }),
    ]), ['2026-11']);
    expect(find(res, 'H', 'E')).toBeUndefined();
    expect(DEFAULT_CONFIG.minExcess).toBeGreaterThan(3);
  });
});
