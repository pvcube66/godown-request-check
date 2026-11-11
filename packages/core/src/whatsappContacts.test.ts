import { describe, expect, it } from 'vitest';
import { cleanTags, contactFilter, maskPhone, normalizePhone, validateContact, ContactInputError } from './whatsappContacts.js';

describe('phone numbers', () => {
  it.each([
    ['9876543210', '919876543210'], ['+91 98765 43210', '919876543210'], ['09876543210', '919876543210'], ['919876543210', '919876543210'],
    ['0091 98765 43210', '919876543210'], ['+1 (415) 555-2671', '14155552671'], ['+44 7911 123456', '447911123456'],
  ])('%j -> %j', (raw, want) => expect(normalizePhone(raw)).toBe(want));
  it.each(['', 'abc', '12345', '1234567890123456', '0123456789', '5876543210', '91987654321', '+91 12345 67890 1'])('refuses %j', (raw) => expect(normalizePhone(raw)).toBeNull());
  it('masks all but the last four digits', () => { expect(maskPhone('919876543210')).toBe('••••••••3210'); expect(maskPhone('123')).toBe('123'); });
});

describe('tags and contact details', () => {
  it('tags are lower-case, deduplicated, hyphenated and limited', () => {
    expect(cleanTags('Hostel, Nalgonda; hostel | Big Group')).toEqual(['hostel', 'nalgonda', 'big-group']);
    expect(cleanTags(['A', 'a', ' b '])).toEqual(['a', 'b']);
    expect(cleanTags(Array.from({ length: 40 }, (_, i) => `t${i}`))).toHaveLength(20);
    expect(cleanTags(null)).toEqual([]);
  });
  it('checks a contact and cleans it', () => {
    expect(validateContact({ phone: '98765 43210', name: '  Ravi  Kumar ', email: 'RAVI@x.com', tags: 'a,b', notes: 'hi' })).toEqual({ phone: '919876543210', name: 'Ravi  Kumar', email: 'ravi@x.com', tags: ['a', 'b'], notes: 'hi' });
    expect(() => validateContact({ phone: 'nope' })).toThrow(ContactInputError);
    expect(() => validateContact({ phone: '9876543210', email: 'not-an-email' })).toThrow(/email/);
  });
  it('strips control characters and caps lengths', () => {
    const v = validateContact({ phone: '9876543210', name: `A\u0007${'x'.repeat(300)}`, notes: 'n'.repeat(5000) });
    expect(v.name.length).toBe(100); expect(v.name).not.toMatch(/\u0007/); expect(v.notes.length).toBe(1000);
  });
});

describe('searching', () => {
  it('searches names, emails, notes and digits literally (no regular-expression tricks)', () => {
    const f = contactFilter({ q: 'a.*(b' }) as { $or: { name?: { $regex: string } }[] };
    expect(new RegExp(f.$or[0]!.name!.$regex, 'i').test('xa.*(bx')).toBe(true);
    expect(new RegExp(f.$or[0]!.name!.$regex, 'i').test('aaab')).toBe(false);
    expect(JSON.stringify(contactFilter({ q: '+91 98765' }))).toContain('"phone":{"$regex":"9198765"}');
  });
  it('filters by tag, group members and opt-out', () => {
    expect(contactFilter({ tag: 'hostel', optedOut: false }, ['91111'])).toEqual({ tags: 'hostel', phone: { $in: ['91111'] }, optedOut: false });
    expect(contactFilter({})).toEqual({});
  });
});
