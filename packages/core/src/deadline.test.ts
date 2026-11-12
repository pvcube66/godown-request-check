import { afterEach, describe, expect, it } from 'vitest';
import { outOfTime, setDeadline } from './deadline.js';

afterEach(() => setDeadline(undefined));
describe('catch-up time limit', () => {
  it('never says "out of time" when no limit is set', () => { setDeadline(undefined); expect(outOfTime()).toBe(false); });
  it('says so once the limit has passed, and not before', () => {
    setDeadline(Date.now() + 60_000); expect(outOfTime()).toBe(false);
    setDeadline(Date.now() - 1); expect(outOfTime()).toBe(true);
  });
});
