import { DEFAULT_CONFIG, type Collections, type DetectorConfig } from '@anomaly/core';
import { runBench } from './bench.js';

/** Compare-with-how-many-hostels settings: more hostels is steadier; fewer is more alike. */
export async function runSweep(c: Collections) {
  const grid: Partial<DetectorConfig>[] = [];
  for (const minPeers of [5, 8, 12]) for (const peerK of [8, 12, 20, 40, 1000]) grid.push({ minPeers, peerK });
  console.log('minPeers K | caught x3 x5 x10 | of truly abnormal x3 x5 x10 | medium/high x5 x10 | zero | new med/high alarms | flags (minor)');
  for (const g of grid) {
    const m = await runBench(c, { ...DEFAULT_CONFIG, ...g }, { quiet: true, blind: false });
    const p = (x: number) => String(Math.round(x * 100)).padStart(3);
    console.log(`${String(g.minPeers).padEnd(8)} ${String(g.peerK).padEnd(5)} |        ${p(m.recall[3]!)} ${p(m.recall[5]!)} ${p(m.recall[10]!)} |               ${p(m.realRecall[3]!)} ${p(m.realRecall[5]!)} ${p(m.realRecall[10]!)} |          ${p(m.medHigh[5]!)} ${p(m.medHigh[10]!)} | ${p(m.zero)} | ${m.noiseNewMH} | ${m.flags} (${m.lowFlags})`);
  }
}
