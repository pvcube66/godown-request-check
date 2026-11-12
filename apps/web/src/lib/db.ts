import { connectDb, type Collections } from '@anomaly/core';

const g = globalThis as unknown as { __cols?: Promise<Collections> };
export const getDb = () => (g.__cols ??= connectDb(undefined, undefined, { indexes: false }));
