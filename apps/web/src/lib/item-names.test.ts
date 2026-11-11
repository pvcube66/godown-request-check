import { describe, expect, it } from 'vitest';
import { itemLabel } from './format';
import { loadItemNames } from './item-names';

describe('readable item names', () => {
  const master = [{ key: 'cardamomelaichi [unit:kg; pack:kg]', name: 'Cardamom (Elaichi)' }, { key: 'vijayasunfloweroil [unit:litre; pack:litre]', name: 'Vijaya Sunflower Oil' }];
  const c = { itemsMaster: { find: () => ({ toArray: async () => master }) } } as never;
  it('turns a stored key into the name the portal uses, without the unit part', async () => {
    const names = await loadItemNames(c);
    expect(itemLabel('cardamomelaichi [unit:kg; pack:kg]', names)).toBe('Cardamom (Elaichi)');
    expect(itemLabel('vijayasunfloweroil', names)).toBe('Vijaya Sunflower Oil');
  });
  it('never shows the [unit: ...] part, even for an item that is not in the master', () => {
    expect(itemLabel('mysteryitem [unit:kg; pack:kg]', {})).toBe('mysteryitem');
    expect(itemLabel('IddliRavva')).toBe('Iddli Ravva');
  });
});
