import { describe, expect, it } from 'vitest';
import { seriesFor } from './hostel';

describe('seriesFor: the month-by-month quantities behind a flag', () => {
  it('uses the exact key when it has the numbers', () => {
    expect(seriesFor({ 'rice [unit:kg; pack:unknown]': { '2026-09': 10, '2026-10': 60 } }, 'rice [unit:kg; pack:unknown]')).toEqual({ '2026-09': 10, '2026-10': 60 });
  });
  it('fills a month saved under another key for the same item (the unit details were read later)', () => {
    const h = { 'dry red chilli (whole)': { '2026-11': 0 }, 'dry red chilli (whole) [unit:kg; pack:unknown]': { '2026-09': 3 } };
    expect(seriesFor(h, 'dry red chilli (whole)')).toEqual({ '2026-09': 3, '2026-11': 0 });
    expect(seriesFor(h, 'dry red chilli (whole) [unit:kg; pack:unknown]')).toEqual({ '2026-09': 3, '2026-11': 0 });
  });
  it('never adds different units together', () => {
    const h = { 'soap [unit:kg; pack:1]': { '2026-09': 2 }, 'soap [unit:packet; pack:1]': { '2026-09': 50, '2026-10': 40 } };
    expect(seriesFor(h, 'soap [unit:kg; pack:1]')).toEqual({ '2026-09': 2 });
  });
  it('does not mix up different items', () => {
    expect(seriesFor({ 'clove': { '2026-09': 1 }, 'cinnamon': { '2026-09': 9 } }, 'clove')).toEqual({ '2026-09': 1 });
  });
  it('handles a hostel with no history', () => { expect(seriesFor(undefined, 'x')).toEqual({}); expect(seriesFor({}, 'x')).toEqual({}); });
});
