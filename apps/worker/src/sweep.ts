import { DEFAULT_CONFIG, type Collections, type DetectorConfig } from '@anomaly/core';
import { runBench } from './bench.js';

/** Goal: catch the mistakes worth reviewing (5x and above) while keeping the list short enough to actually review. */
export async function runSweep(c: Collections) {
  const grid: Partial<DetectorConfig>[] = [];
  for (const peerRatio of [2.5, 3, 3.5, 4]) for (const peerZ of [1, 1.5, 2]) for (const ownRatio of [2.5, 3]) grid.push({ peerRatio, peerZ, ownRatio });
  console.log('peerR peerZ ownR | caught x3 x5 x10 | medium/high x5 x10 | zero | new med/high alarms | flags (minor)');
  for (const g of grid) {
    const m = await runBench(c, { ...DEFAULT_CONFIG, ...g }, { quiet: true, blind: false });
    const p = (x: number) => String(Math.round(x * 100)).padStart(3);
    console.log(`${String(g.peerRatio).padEnd(5)} ${String(g.peerZ).padEnd(5)} ${String(g.ownRatio).padEnd(4)} |        ${p(m.recall[3]!)} ${p(m.recall[5]!)} ${p(m.recall[10]!)} |          ${p(m.medHigh[5]!)} ${p(m.medHigh[10]!)} | ${p(m.zero)} | ${m.noiseNewMH} | ${m.flags} (${m.lowFlags})`);
  }
}
