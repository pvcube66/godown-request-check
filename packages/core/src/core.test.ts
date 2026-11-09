import { describe, it, expect } from 'vitest';
import { newScode, portalDecrypt, portalEncrypt } from './portalCrypto.js';
import { openSecret, sealSecret } from './secretBox.js';
import { parseGodownRows, parseQty, resolveMonth } from './parser.js';
import { parsePortalTime } from './portalClient.js';

const KEY = 'a'.repeat(64);

describe('portal crypto', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const s = newScode();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    const a = portalEncrypt('GDN-JGL', s), b = portalEncrypt('GDN-JGL', s);
    expect(a).not.toBe(b);
    expect(portalDecrypt(a, s)).toBe('GDN-JGL');
  });
  it('matches the portal wire format (iv+cipher; 10-char text -> 32 bytes)', () => {
    expect(Buffer.from(portalEncrypt('Sample@1234', newScode()), 'base64').length).toBe(32);
  });
});

describe('secretBox', () => {
  it('round-trips and rejects tampering', () => {
    const sealed = sealSecret('hunter2', KEY);
    expect(openSecret(sealed, KEY)).toBe('hunter2');
    const raw = Buffer.from(sealed, 'base64'); raw[raw.length - 1]! ^= 1;
    expect(() => openSecret(raw.toString('base64'), KEY)).toThrow();
  });
  it('rejects a bad key', () => expect(() => sealSecret('x', 'short')).toThrow());
});

describe('parser', () => {
  it('parses quantities', () => {
    expect(parseQty('15.00JS:15')).toBe(15);
    expect(parseQty('0.50JS:0.5')).toBe(0.5);
    expect(parseQty(20.25)).toBe(20.25);
    expect(parseQty(0)).toBe(0);
    expect(parseQty(null)).toBe(0);
  });
  it('resolves month incl. year rollover', () => {
    expect(resolveMonth('04-11-2026', 'November')).toEqual({ iso: '2026-11-04', month: '2026-11' });
    expect(resolveMonth('28-12-2026', 'January').month).toBe('2027-01');
    expect(() => resolveMonth('04-11-2026', 'Nope')).toThrow();
  });
  it('parses a portal row (sample from the real response)', () => {
    const [r] = parseGodownRows([{
      society_id: 'MJPTBCWREIS', request_id: 'IR202600009744', request_date: '04-11-2026',
      hostel_name: '2611010007-MJPTBCW RDC-JOGULAMBA GADWAL(ALAMPUR)', district_name: 'Jogulamba Gadwal',
      godown_name: 'Gadwal', month_name: 'November', status: 'Pending', dc_number: null, dc_date: null,
      'Chicken Masala Powder': 0, 'Semiya (Vermicelli)': '15.00JS:15', 'Boost (Health Drink)': 20.25,
      IddliRavva: '30.00JS:30',
    }], 2);
    expect(r!.hostelCode).toBe('2611010007');
    expect(r!.month).toBe('2026-11');
    expect(r!.dcNumber).toBeNull();
    expect(r!.items).toEqual({
      'Chicken Masala Powder': 0, 'Semiya (Vermicelli)': 15, 'Boost (Health Drink)': 20.25, IddliRavva: 30,
    });
  });
});

describe('portal time', () => {
  it('parses microsecond timestamps (differences are what matter)', () => {
    expect(parsePortalTime('2026-11-09 12:43:59.960131').toISOString()).toBe('2026-11-09T12:43:59.960Z');
  });
});
