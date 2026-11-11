import { describe, expect, it } from 'vitest';
import { STATUS_LABEL, BATCH_SIZE, DAILY_CAP } from './whatsappCampaigns.js';

describe('campaign constants', () => {
  it('has a plain label for every status', () => { for (const k of ['draft', 'running', 'paused', 'done', 'cancelled'] as const) expect(STATUS_LABEL[k]).toBeTruthy(); });
  it('sends in small batches under a sensible daily cap', () => { expect(BATCH_SIZE).toBeLessThanOrEqual(50); expect(DAILY_CAP).toBeGreaterThanOrEqual(BATCH_SIZE); });
});
