import { describe, it, expect } from 'vitest';
import { academicYearFor, academicYearWindows, daysBetween, daysInStage, orderPatch, parsePortalDay, portalSince, stageOf } from './orders.js';

// Synthetic rows with the same field names the portal uses. No personal details.
const row = (over: Record<string, unknown> = {}) => ({
  request_id: 'IR-TEST-1', hostel_id: 2612020421, hostel_name: 'TEST HOSTEL', district: 'Nagarkurnool',
  month_name: 'November', academic_year: '2026-27', requested_date: '04-11-2026', created_dt: '04-11-2026',
  status: 'Pending', dc_number: null, dc_date: null, supplied_dt: null, received_dt: null, vehicle_regno: null,
  ...over,
});

describe('stage mapping', () => {
  it('maps every portal status, including the portal typo In_Trasit', () => {
    expect(stageOf('Pending')).toBe('pending');
    expect(stageOf('DC_Generated')).toBe('dc');
    expect(stageOf('In_Trasit')).toBe('transit');
    expect(stageOf('Acknowledged')).toBe('received');
    expect(stageOf('Variation')).toBe('variation');
    expect(stageOf('Rejected')).toBe('rejected');
    expect(stageOf('Cancelled')).toBe('cancelled');
    expect(stageOf('Something new')).toBe('other');
  });
});

describe('dates', () => {
  it('reads dd-mm-yyyy as India midnight', () => {
    expect(parsePortalDay('05-09-2026')?.toISOString()).toBe('2026-09-04T18:30:00.000Z');
    expect(parsePortalDay('')).toBeNull();
    expect(parsePortalDay('2026-09-05')).toBeNull();
  });
  it('counts calendar days in India time', () => {
    const from = parsePortalDay('05-09-2026')!;
    expect(daysBetween(from, new Date('2026-11-10T06:00:00Z'))).toBe(66);
    expect(daysBetween(from, from)).toBe(0);
  });
  it('academic year starts in June', () => {
    expect(academicYearFor(2026, 9)).toBe('2026-27');
    expect(academicYearFor(2027, 2)).toBe('2026-27');
    expect(academicYearFor(2027, 6)).toBe('2027-28');
  });
  it('fetches all twelve months of the academic year we are in', () => {
    const w = academicYearWindows(new Date('2026-11-10T06:00:00Z'));
    expect(w).toHaveLength(12);
    expect(w[0]).toEqual({ monthName: 'June', academicYear: '2026-27' });
    expect(w[3]!.monthName).toBe('September');
    expect(w[11]).toEqual({ monthName: 'May', academicYear: '2026-27' });
    expect(academicYearWindows(new Date('2027-03-01T06:00:00Z'))[0]!.academicYear).toBe('2026-27');
  });
});

describe('portal dates per stage', () => {
  it('takes the portal date for each stage and none for cancel/reject', () => {
    const r = row({ dc_date: '06-11-2026', supplied_dt: '06-11-2026', received_dt: '09-11-2026' });
    expect(portalSince(r, 'pending')?.toISOString()).toBe('2026-11-03T18:30:00.000Z');
    expect(portalSince(r, 'dc')?.toISOString()).toBe('2026-11-05T18:30:00.000Z');
    expect(portalSince(r, 'received')?.toISOString()).toBe('2026-11-08T18:30:00.000Z');
    expect(portalSince(r, 'cancelled')).toBeNull();
    expect(portalSince(r, 'rejected')).toBeNull();
  });
});

describe('days in stage', () => {
  it('a pending order counts days from the day it was placed', () => {
    const p = orderPatch(row({ requested_date: '05-09-2026' }), undefined, new Date('2026-11-10T06:00:00Z'));
    expect(p.stageChanged).toBe(true);
    expect(p.entry.source).toBe('portal');
    expect(daysInStage({ stageSince: p.header.stageSince }, new Date('2026-11-10T06:00:00Z'))).toBe(66);
  });
});

describe('stage history', () => {
  const t0 = new Date('2026-11-06T06:00:00Z');
  const t1 = new Date('2026-11-10T06:00:00Z');

  it('a cancelled order has no portal date, so it is marked as first seen by us', () => {
    const p = orderPatch(row({ status: 'Cancelled' }), undefined, t0);
    expect(p.header.stage).toBe('cancelled');
    expect(p.entry).toEqual({ stage: 'cancelled', since: t0, source: 'observed' });
  });

  it('a change of stage is detected; the same stage is not', () => {
    const first = orderPatch(row({ status: 'Pending' }), undefined, t0);
    const same = orderPatch(row({ status: 'Pending' }), { stage: 'pending' }, t1);
    expect(same.stageChanged).toBe(false);
    const moved = orderPatch(row({ status: 'DC_Generated', dc_date: '06-11-2026', dc_number: 'DC-1' }), { stage: first.header.stage }, t1);
    expect(moved.stageChanged).toBe(true);
    expect(moved.entry.stage).toBe('dc');
    expect(moved.header.dcNumber).toBe('DC-1');
    expect(moved.entry.since.toISOString()).toBe('2026-11-05T18:30:00.000Z');
  });
});
