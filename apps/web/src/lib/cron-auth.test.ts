import { describe, expect, it } from 'vitest';
import { authorised } from './cron-auth';

describe('the hourly check address', () => {
  const secret = 'a-long-random-secret-value-123';
  it('runs only with the exact secret', () => {
    expect(authorised(`Bearer ${secret}`, secret)).toBe(true);
    for (const h of [null, '', 'Bearer', `Bearer ${secret}x`, `bearer ${secret}`, secret, 'Bearer wrong']) expect(authorised(h, secret)).toBe(false);
  });
  it('is closed when no secret is set or the secret is too short to be safe', () => {
    expect(authorised('Bearer ', '')).toBe(false); expect(authorised('Bearer short', 'short')).toBe(false); expect(authorised('Bearer undefined', undefined)).toBe(false);
  });
});
