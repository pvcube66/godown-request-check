/** One worker of the benchmark's thread pool: runs the detector on whatever request sets it is sent. */
import { parentPort, workerData } from 'node:worker_threads';
import { detectAnomalies } from '@anomaly/core';

const { cfg, sizes, month } = workerData as { cfg: Parameters<typeof detectAnomalies>[2]; sizes: [string, number][]; month: string };
const sizeMap = new Map(sizes);
parentPort!.on('message', ({ id, reqs }: { id: number; reqs: Parameters<typeof detectAnomalies>[0] }) => {
  parentPort!.postMessage({ id, out: detectAnomalies(reqs, [month], cfg, sizeMap) });
});
