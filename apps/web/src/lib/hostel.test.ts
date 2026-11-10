import { describe, expect, it } from 'vitest';
import { monthComparison, monthRange, sameItem, sizeWords } from './hostel';

const h = { Sugar: { '2026-09': 30, '2026-10': 30, '2026-11': 300 }, Rice: { '2026-09': 500, '2026-10': 520, '2026-11': 510 }, Oil: { '2026-09': 20 } };
const months = ['2026-09', '2026-10', '2026-11'];

describe('month against the hostel’s own earlier months', () => {
  const rows = monthComparison(h, months, '2026-11');
  it('compares each item with the average of the earlier months and puts the biggest jump first', () => {
    expect(rows[0]).toMatchObject({ item: 'Sugar', thisMonth: 300, earlierAverage: 30, earlierMonths: 2, ratio: 10 });
    expect(rows.find((r) => r.item === 'Rice')!.ratio).toBeCloseTo(510 / 510);
  });
  it('shows an item asked for earlier but not this month (as 0 this month)', () => {
    expect(rows.find((r) => r.item === 'Oil')).toMatchObject({ thisMonth: 0, earlierAverage: 10, ratio: 0 });
  });
  it('has nothing to compare for the first month', () => {
    const first = monthComparison(h, months, '2026-09');
    expect(first.every((r) => r.ratio === null && r.earlierMonths === 0)).toBe(true);
  });
  it('is empty for a hostel with no history, or a month with no indent and no earlier usage', () => {
    expect(monthComparison(undefined, months, '2026-11')).toEqual([]);
    expect(monthComparison({ Sugar: { '2026-11': 5 } }, months, '2026-09')).toEqual([]);
  });
});

describe('month list', () => {
  it('fills the gaps so a month with no indent can be chosen', () => {
    expect(monthRange(['2026-09', '2026-12'])).toEqual(['2026-09', '2026-10', '2026-11', '2026-12']);
    expect(monthRange(['2026-11', '2027-02'])).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthRange([])).toEqual([]);
    expect(monthRange(['2026-11'])).toEqual(['2026-11']);
  });
});

describe('words and names', () => {
  it('describes size in plain words', () => {
    expect(sizeWords(null)).toMatch(/no earlier/);
    expect(sizeWords(10)).toBe('10.0 times the usual');
    expect(sizeWords(1.5)).toBe('a bit more than usual');
    expect(sizeWords(1)).toBe('about the usual');
    expect(sizeWords(0.5)).toBe('less than usual');
    expect(sizeWords(0)).toBe('none this month');
  });
  it('matches an indent row to a history key with or without a unit suffix', () => {
    expect(sameItem('Dried Green Peas', 'driedgreenpeas [unit:kg; pack:1]')).toBe(true);
    expect(sameItem('Sugar', 'Sugar')).toBe(true);
    expect(sameItem('Sugar', 'rice')).toBe(false);
  });
});
