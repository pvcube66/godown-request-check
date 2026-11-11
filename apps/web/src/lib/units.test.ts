import { describe, expect, it } from 'vitest';
import { unitFor, withUnit } from './units';

describe('units next to quantities', () => {
  const units = { rice: 'Kg', sugar: 'Kg' };
  it('reads the unit out of a unit-aware item key', () => {
    expect(unitFor('rice [unit:kg; pack:1]', {})).toBe('kg');
    expect(unitFor('oil [unit:litre; pack:500ml]', {})).toBe('litre');
  });
  it('looks a plain item name up in the item master (spacing and case do not matter)', () => {
    expect(unitFor('Rice', units)).toBe('Kg');
    expect(unitFor('SUGAR ', units)).toBe('Kg');
  });
  it('is blank, never a guess, when the unit is not known', () => {
    expect(unitFor('Dal', units)).toBe('');
    expect(unitFor('dal [unit:unknown; pack:unknown]', {})).toBe('');
  });
  it('writes a quantity with its unit, or alone when unknown', () => {
    expect(withUnit('13', 'kg')).toBe('13 kg');
    expect(withUnit('13', '')).toBe('13');
  });
});
