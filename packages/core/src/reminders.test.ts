import { describe, expect, it } from 'vitest';
import { decide, istHour, type ReminderCandidate, type Rules } from './reminders.js';

const rules: Rules = { firstAfterDays: 3, everyDays: 2, maxMessages: 4, windowFrom: 9, windowTo: 18 };
const NOON = new Date('2026-11-10T06:30:00Z');                   // 12:00 India
const cand = (o: Partial<ReminderCandidate> = {}): ReminderCandidate => ({ requestId: 'R1', hostelCode: 'H1', hostelName: 'H', districtName: 'D', daysInTransit: 3, dispatchedOn: new Date('2026-11-07T00:00:00Z'), phone: '919876543210', optedOut: false, sentAt: [], hostelMessagedToday: false, ...o });
const day = (s: string) => new Date(`${s}T06:30:00Z`);

describe('when a reminder goes out', () => {
  it('first one after 3 days in transit, not before', () => {
    expect(decide(cand({ daysInTransit: 2 }), rules, NOON)).toEqual({ send: false, reason: 'too_early' });
    expect(decide(cand({ daysInTransit: 3 }), rules, NOON)).toEqual({ send: true, reminderNo: 1 });
    expect(decide(cand({ daysInTransit: 20 }), rules, NOON)).toEqual({ send: true, reminderNo: 1 });
  });
  it('then every 2 days, counted in India calendar days', () => {
    expect(decide(cand({ sentAt: [day('2026-11-09')] }), rules, NOON)).toEqual({ send: false, reason: 'waiting_between' });
    expect(decide(cand({ sentAt: [day('2026-11-08')] }), rules, NOON)).toEqual({ send: true, reminderNo: 2 });
    expect(decide(cand({ sentAt: [day('2026-11-04'), day('2026-11-08')] }), rules, NOON)).toEqual({ send: true, reminderNo: 3 });
  });
  it('stops after the fourth (or the set number)', () => {
    const four = [day('2026-11-01'), day('2026-11-03'), day('2026-11-05'), day('2026-11-07')];
    expect(decide(cand({ sentAt: four }), rules, NOON)).toEqual({ send: false, reason: 'max_reached' });
    expect(decide(cand({ sentAt: [day('2026-11-01')] }), { ...rules, maxMessages: 1 }, NOON)).toEqual({ send: false, reason: 'max_reached' });
  });
  it('uses the changed numbers when an administrator changes them', () => {
    expect(decide(cand({ daysInTransit: 4 }), { ...rules, firstAfterDays: 5 }, NOON)).toEqual({ send: false, reason: 'too_early' });
    expect(decide(cand({ sentAt: [day('2026-11-08')] }), { ...rules, everyDays: 5 }, NOON)).toEqual({ send: false, reason: 'waiting_between' });
  });
  it('never messages a hostel with no usable number, one that opted out, or one already messaged today', () => {
    expect(decide(cand({ phone: null }), rules, NOON)).toEqual({ send: false, reason: 'no_phone' });
    expect(decide(cand({ optedOut: true }), rules, NOON)).toEqual({ send: false, reason: 'opted_out' });
    expect(decide(cand({ hostelMessagedToday: true }), rules, NOON)).toEqual({ send: false, reason: 'hostel_cap' });
  });
  it('opt-out wins over everything else', () => {
    expect(decide(cand({ optedOut: true, phone: null, daysInTransit: 0 }), rules, NOON)).toEqual({ send: false, reason: 'opted_out' });
  });
  it('sends only in the daytime window (India time)', () => {
    expect(istHour(new Date('2026-11-10T03:30:00Z'))).toBe(9);
    expect(decide(cand(), rules, new Date('2026-11-10T03:29:00Z'))).toEqual({ send: false, reason: 'outside_window' });   // 08:59
    expect(decide(cand(), rules, new Date('2026-11-10T03:30:00Z')).send).toBe(true);                                       // 09:00
    expect(decide(cand(), rules, new Date('2026-11-10T12:29:00Z')).send).toBe(true);                                       // 17:59
    expect(decide(cand(), rules, new Date('2026-11-10T12:30:00Z'))).toEqual({ send: false, reason: 'outside_window' });   // 18:00
    expect(decide(cand(), rules, new Date('2026-11-09T22:00:00Z'))).toEqual({ send: false, reason: 'outside_window' });   // 03:30 next day
  });
});
