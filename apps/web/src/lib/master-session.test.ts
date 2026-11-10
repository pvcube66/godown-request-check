import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkMasterPassword, makeMasterSession, masterAdminConfigured, verifyMasterSession } from './master-session';

beforeEach(() => {
  vi.stubEnv('DASHBOARD_PASSWORD', 'synthetic-dashboard-password');
  vi.stubEnv('MASTER_ADMIN_PASSWORD', 'synthetic-separate-admin-password');
});
afterEach(() => vi.unstubAllEnvs());

describe('temporary master admin session', () => {
  it('requires a separate sufficiently long secret', () => {
    expect(masterAdminConfigured()).toBe(true);
    vi.stubEnv('MASTER_ADMIN_PASSWORD', 'short');
    expect(masterAdminConfigured()).toBe(false);
    vi.stubEnv('MASTER_ADMIN_PASSWORD', 'synthetic-dashboard-password');
    expect(masterAdminConfigured()).toBe(false);
    vi.stubEnv('MASTER_ADMIN_PASSWORD', '');
    expect(masterAdminConfigured()).toBe(false);
  });
  it('checks the exact administrator password', () => {
    expect(checkMasterPassword('synthetic-separate-admin-password')).toBe(true);
    expect(checkMasterPassword('synthetic-dashboard-password')).toBe(false);
    expect(checkMasterPassword('synthetic-separate-admin-password ')).toBe(false);
  });
  it('binds the unlock to the dashboard session', () => {
    const token = makeMasterSession('dashboard-session-a', 1000);
    expect(verifyMasterSession(token, 'dashboard-session-a', 1001)).toBe(true);
    expect(verifyMasterSession(token, 'dashboard-session-b', 1001)).toBe(false);
  });
  it('expires after one hour and rejects tampering', () => {
    const token = makeMasterSession('dashboard-session', 1000);
    expect(verifyMasterSession(token, 'dashboard-session', 3601000)).toBe(false);
    expect(verifyMasterSession(`${token}x`, 'dashboard-session', 1001)).toBe(false);
    expect(verifyMasterSession(`${token}.extra`, 'dashboard-session', 1001)).toBe(false);
    expect(verifyMasterSession(undefined, 'dashboard-session', 1001)).toBe(false);
  });
  it('invalidates previous unlocks after secret rotation', () => {
    const token = makeMasterSession('dashboard-session', 1000);
    vi.stubEnv('MASTER_ADMIN_PASSWORD', 'another-separate-admin-secret');
    expect(verifyMasterSession(token, 'dashboard-session', 1001)).toBe(false);
  });
});
