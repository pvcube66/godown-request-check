import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearItemMasterCache, getItemMasters } from './item-master-cache';

const fake = (impl: () => Promise<unknown[]>) => { const toArray = vi.fn(impl); return { c: { itemsMaster: { find: () => ({ toArray }) } } as never, toArray }; };

describe('item master cache', () => {
  beforeEach(() => clearItemMasterCache());
  it('reads the database once for repeated calls', async () => {
    const { c, toArray } = fake(async () => [{ key: 'a' }]);
    expect(await getItemMasters(c)).toEqual([{ key: 'a' }]);
    await getItemMasters(c); await getItemMasters(c);
    expect(toArray).toHaveBeenCalledTimes(1);
  });
  it('reads again after it is cleared (a correction was saved)', async () => {
    const { c, toArray } = fake(async () => []);
    await getItemMasters(c); clearItemMasterCache(); await getItemMasters(c);
    expect(toArray).toHaveBeenCalledTimes(2);
  });
  it('never keeps a failed read', async () => {
    let n = 0;
    const { c, toArray } = fake(async () => { if (n++ === 0) throw new Error('down'); return [{ key: 'ok' }]; });
    await expect(getItemMasters(c)).rejects.toThrow('down');
    expect(await getItemMasters(c)).toEqual([{ key: 'ok' }]);
    expect(toArray).toHaveBeenCalledTimes(2);
  });
});
