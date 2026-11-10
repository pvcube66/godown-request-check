import { afterEach, describe, it, expect, vi } from 'vitest';
import { newScode, portalDecrypt, portalEncrypt } from './portalCrypto.js';
import { openSecret, sealSecret } from './secretBox.js';
import { parseGodownRows, parseQty, resolveMonth } from './parser.js';
import { fetchRequestItems, fetchRequestRemark, parsePortalTime, PortalAuthError } from './portalClient.js';

const KEY = 'a'.repeat(64);

afterEach(() => vi.unstubAllGlobals());

describe('request item GET reads', () => {
  const reply = (body: unknown, status = 200) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('reads the permitted endpoint and whitelists raw metadata/quantity fields only', async () => {
    const fetchMock = reply({ success: true, data: [{
      item_id: 17, item_name: 'Rice', uom: 'pack', pack_size: '200g', brand: 'Test', item_category: 'Grain',
      requested_quantity: '10.5', supplied_quantity: '9', received_quantity: 8, variation_quantity: -1, final_quantity: 7,
      student_name: 'Must not retain', student_id: 'private', remarks: ' business remark ',
    }] });
    const items = await fetchRequestItems('token', 'IR /1');
    expect(items).toEqual([{
      itemId: '17', name: 'Rice', unit: 'pack', packSize: '200g', brand: 'Test', category: 'Grain',
      requestedQuantity: 10.5, suppliedQuantity: 9, receivedQuantity: 8, variationQuantity: -1, finalQuantity: 7,
      remarks: 'business remark',
    }]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('GetIndentHostelToVendorRequestItems?requestId=IR%20%2F1'), expect.objectContaining({ headers: { Authorization: 'Bearer token', Accept: 'application/json' } }));
    expect(fetchMock.mock.calls[0]![1].method).toBe('GET');
  });

  it('accepts explicit no-record and empty-array responses but rejects unexpected/error responses', async () => {
    reply({ success: false, data: { status: 0, msg: 'No records found' } });
    expect(await fetchRequestItems('token', 'id')).toEqual([]);
    reply({ success: true, data: [] });
    expect(await fetchRequestItems('token', 'id')).toEqual([]);
    reply({ success: false, message: 'Session expired' });
    await expect(fetchRequestItems('token', 'id')).rejects.toThrow(PortalAuthError);
    reply({ success: false, data: { msg: 'Database unavailable' } });
    await expect(fetchRequestItems('token', 'id')).rejects.toThrow('unexpected response');
    reply({ success: false, data: [], message: 'Database unavailable' });
    await expect(fetchRequestItems('token', 'id')).rejects.toThrow('unsuccessful');
    reply({ success: false, data: [], message: 'Session expired' });
    await expect(fetchRequestItems('token', 'id')).rejects.toThrow(PortalAuthError);
    reply({ success: false, data: [{ item_name: 'Rice' }] });
    await expect(fetchRequestItems('token', 'id')).rejects.toThrow('unsuccessful');
    reply({}, 500);
    await expect(fetchRequestItems('token', 'id')).rejects.toThrow('HTTP 500');
    for (const status of [401, 403]) {
      reply({}, status);
      await expect(fetchRequestItems('token', 'id')).rejects.toThrow(PortalAuthError);
    }
  });

  it('reuses the read for remarks without writes and preserves auth errors', async () => {
    const fetchMock = reply({ data: [{ item_name: 'Rice', remarks: '', supplier_remarks: ' Corrected order ' }] });
    expect(await fetchRequestRemark('token', 'id')).toBe('Corrected order');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    reply({ data: [] });
    expect(await fetchRequestRemark('token', 'id')).toBeNull();
    reply({}, 401);
    await expect(fetchRequestRemark('token', 'id')).rejects.toThrow(PortalAuthError);
  });
});

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
