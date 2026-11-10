import { describe, expect, it } from 'vitest';
import { judge, STALE_MINUTES } from './health';

const now = new Date('2026-11-10T12:00:00Z');
describe('is the hourly check healthy?', () => {
  it('healthy within two hours of the last success', () => {
    expect(judge(new Date('2026-11-10T11:10:00Z'), true, 0, now)).toMatchObject({ ok: true, minutesSince: 50 });
    expect(judge(new Date(now.getTime() - STALE_MINUTES * 60_000), true, 0, now).ok).toBe(true);
  });
  it('not healthy after more than two hours, or when it has never succeeded', () => {
    expect(judge(new Date(now.getTime() - (STALE_MINUTES + 1) * 60_000), true, 0, now).ok).toBe(false);
    expect(judge(null, null, 0, now)).toMatchObject({ ok: false, minutesSince: null });
  });
  it('a last run that failed does not hide an older success from the age check, but is reported', () => {
    expect(judge(new Date('2026-11-10T11:30:00Z'), false, 2, now)).toMatchObject({ ok: true, lastRunOk: false, needAttention: 2 });
  });
  it('never reports negative minutes if the clocks differ', () => {
    expect(judge(new Date('2026-11-10T12:05:00Z'), true, 0, now).minutesSince).toBe(0);
  });
});
