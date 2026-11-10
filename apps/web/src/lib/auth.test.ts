import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BREAK_GLASS, checkPassword, makeSession, sessionSubject } from './auth';

beforeEach(() => { vi.stubEnv('DASHBOARD_PASSWORD', 'synthetic-dashboard-password'); vi.stubEnv('CREDENTIAL_ENC_KEY', 'synthetic-key'); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('sessions', () => {
  it('returns the subject of a good session', () => {
    expect(sessionSubject(makeSession('user-123'))).toBe('user-123');
    expect(sessionSubject(makeSession(BREAK_GLASS))).toBe(BREAK_GLASS);
  });
  it('rejects a changed subject, a changed expiry, and a missing or malformed cookie', () => {
    const [sub, exp, sig] = makeSession('user-123').split('.');
    expect(sessionSubject(`other.${exp}.${sig}`)).toBeNull();
    expect(sessionSubject(`${sub}.${Number(exp) + 1}.${sig}`)).toBeNull();
    expect(sessionSubject(`${sub}.${exp}.${sig}.extra`)).toBeNull();
    expect(sessionSubject('')).toBeNull();
    expect(sessionSubject(undefined)).toBeNull();
    expect(sessionSubject('just-one-part')).toBeNull();
  });
  it('rejects an old-format cookie from before users existed', () => {
    expect(sessionSubject('1999999999999.abcdef')).toBeNull();
  });
  it('expires', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
    const s = makeSession('u1', 1);
    vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
    expect(sessionSubject(s)).toBeNull();
  });
  it('stops working when the signing secret changes', () => {
    const s = makeSession('u1');
    vi.stubEnv('DASHBOARD_PASSWORD', 'a-different-password');
    expect(sessionSubject(s)).toBeNull();
  });
  it('refuses subjects that could break the format, and works only when the password is configured', () => {
    expect(() => makeSession('a.b')).toThrow();
    expect(() => makeSession('')).toThrow();
    const s = makeSession('u1');
    vi.stubEnv('DASHBOARD_PASSWORD', '');
    expect(sessionSubject(s)).toBeNull();
  });
  it('checks the emergency password', () => {
    expect(checkPassword('synthetic-dashboard-password')).toBe(true);
    expect(checkPassword('nope')).toBe(false);
  });
});
