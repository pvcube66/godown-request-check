import { describe, expect, it } from 'vitest';
import { stageSummary, summarize, type SummaryOrder } from './dashboard';
import { csvCell } from './csv';

const now = new Date('2026-11-20T10:00:00+05:30');
const day = (s: string) => new Date(`${s}T00:00:00+05:30`);
const o = (account: string, districtName: string, hostelCode: string, stage: SummaryOrder['stage'], since: string): SummaryOrder => ({ account, districtName, hostelCode, stage, stageSince: day(since) });
const data: SummaryOrder[] = [
  o('A', 'Nalgonda', 'H1', 'pending', '2026-11-01'),          // 19 days: stuck 7 and 15
  o('A', 'NALGONDA ', 'H2', 'transit', '2026-11-12'),         // 8 days: stuck 7
  o('A', 'Nalgonda', 'H2', 'received', '2026-10-01'),         // acknowledged long ago: never stuck
  o('B', 'Warangal', 'H3', 'pending', '2026-11-19'),          // 1 day
  o('B', 'Warangal', 'H3', 'cancelled', '2026-10-01'),        // final: never stuck
  o('B', 'Warangal', 'H4', 'variation', '2026-11-05'),        // 15 days: stuck 7 and 15 (variation is counted)
];

describe('district-wise dashboard', () => {
  const rows = summarize(data, 'district', now);
  it('groups spellings of one district together and counts every order once', () => {
    expect(rows).toHaveLength(2);
    expect(rows.reduce((n, r) => n + r.total, 0)).toBe(data.length);
    const nal = rows.find((r) => r.label.startsWith('Nalgonda'))!;
    expect(nal).toMatchObject({ total: 3, hostels: 2, stuck7: 2, stuck15: 1 });
    expect(nal.byStage).toMatchObject({ pending: 1, transit: 1, received: 1 });
  });
  it('counts stuck orders only in open stages (Acknowledge and Cancelled never)', () => {
    const war = rows.find((r) => r.label === 'Warangal')!;
    expect(war).toMatchObject({ total: 3, hostels: 2, stuck7: 1, stuck15: 1 });
    expect(war.byStage).toMatchObject({ pending: 1, cancelled: 1, variation: 1 });
  });
  it('lists the district with the most stuck orders first, and gives the filter to open its orders', () => {
    expect(rows[0]!.stuck7).toBeGreaterThanOrEqual(rows[1]!.stuck7);
    expect(rows[0]!.filter).toHaveProperty('district');
  });
});

describe('godown-wise and stage-wise dashboards', () => {
  it('groups by portal login and shows the godown name', () => {
    const rows = summarize(data, 'godown', now, (a) => ({ A: 'Jogulamba', B: 'Warangal godown' }[a] ?? a));
    expect(rows.map((r) => r.label).sort()).toEqual(['Jogulamba', 'Warangal godown']);
    expect(rows.find((r) => r.label === 'Jogulamba')!.filter).toEqual({ account: 'A' });
  });
  it('the overall (stage) table adds up to the same total as every other view', () => {
    const s = stageSummary(data, now);
    expect(s.total).toBe(data.length);
    expect(s.rows.reduce((n, r) => n + r.orders, 0)).toBe(data.length);
    expect(s.rows.find((r) => r.stage === 'pending')).toMatchObject({ orders: 2, hostels: 2, stuck7: 1, stuck15: 1 });
    expect(s.rows.find((r) => r.stage === 'received')).toMatchObject({ orders: 1, stuck7: 0 });
    expect(s.rows.some((r) => r.stage === 'other')).toBe(false);          // an empty "Other" row is not shown
    expect(s.rows.reduce((n, r) => n + r.stuck7, 0)).toBe(summarize(data, 'district', now).reduce((n, r) => n + r.stuck7, 0));
  });
  it('shows an Other row only when there are such orders', () => {
    expect(stageSummary([...data, o('A', 'Nalgonda', 'H9', 'other', '2026-11-01')], now).rows.some((r) => r.stage === 'other')).toBe(true);
  });
});

describe('CSV cells', () => {
  it('quotes text and doubles quotes', () => expect(csvCell('say "hi"')).toBe('"say ""hi"""'));
  it('stops a spreadsheet from running typed text as a formula', () => {
    for (const bad of ['=SUM(A1)', '+1', '-1', '@x', '\tx']) expect(csvCell(bad).startsWith('"\'')).toBe(true);
  });
  it('leaves numbers and blanks alone', () => { expect(csvCell(-5)).toBe('-5'); expect(csvCell(null)).toBe('""'); expect(csvCell(Number.NaN)).toBe(''); });
});
