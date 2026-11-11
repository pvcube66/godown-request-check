import { describe, expect, it } from 'vitest';
import { ensureDistricts } from './seedMasterData.js';
import { normalizedDistrictCode } from './sync.js';

describe('districts appear by themselves', () => {
  const make = (req: string[], ord: string[], have: string[] = []) => {
    const saved = new Map<string, string>(have.map((n) => [normalizedDistrictCode(n), n]));
    return { saved, c: {
      requests: { distinct: async () => req }, orders: { distinct: async () => ord },
      districts: { updateOne: async (f: { code: string }, u: { $setOnInsert: { name: string } }) => { if (saved.has(f.code)) return { upsertedCount: 0 }; saved.set(f.code, u.$setOnInsert.name); return { upsertedCount: 1 }; } },
    } as never };
  };
  it('saves each new district once, tidies spacing and case, and ignores blanks', async () => {
    const { c, saved } = make(['Nagarkurnool', ' Jogulamba  Gadwal ', ''], ['NAGARKURNOOL', 'Warangal']);
    expect(await ensureDistricts(c)).toBe(3);
    expect([...saved.values()].sort()).toEqual(['Jogulamba  Gadwal', 'Nagarkurnool', 'Warangal'].sort());
  });
  it('leaves districts that are already saved alone and adds nothing the second time', async () => {
    const { c } = make(['Nagarkurnool'], [], ['Nagarkurnool']);
    expect(await ensureDistricts(c)).toBe(0);
  });
});
