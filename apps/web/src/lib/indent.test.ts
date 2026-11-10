import { describe, expect, it } from 'vitest';
import { normalizedItemName, itemVariantKey } from '@anomaly/core';
import { flaggedItemName, isFlaggedRow } from './indent';

describe('which indent rows a flag is about', () => {
  const row = (name: string) => ({ name, quantity: 1, unit: 'kg', packSize: '1' });
  it('matches a plain item name regardless of spacing, case and symbols', () => {
    expect(isFlaggedRow(row('Dried Green Peas'), new Set([flaggedItemName('dried green peas')]))).toBe(true);
    expect(isFlaggedRow(row('Sugar'), new Set([flaggedItemName('Dried Green Peas')]))).toBe(false);
  });
  it('matches the unit-aware item key the detector uses for items with a known unit', () => {
    const key = itemVariantKey({ name: 'Sugar', unit: 'Kg', packSize: '1' });
    expect(flaggedItemName(key)).toBe(normalizedItemName('Sugar'));
    expect(isFlaggedRow(row('Sugar'), new Set([flaggedItemName(key)]))).toBe(true);
    expect(isFlaggedRow(row('Sugar Free Mix'), new Set([flaggedItemName(key)]))).toBe(false);
  });
});
