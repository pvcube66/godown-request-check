import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHostelStudents } from './portalClient.js';

afterEach(() => vi.unstubAllGlobals());
const reply = (days: Record<number, number[]>) => vi.fn(async (url: string) => {
  const back = Math.round((Date.now() - new Date(new URL(url).searchParams.get('date')! + 'T00:00:00Z').getTime()) / 86_400_000);
  return new Response(JSON.stringify({ success: true, data: (days[back] ?? []).map((n) => ({ total_students: n })) }), { status: 200 });
});

describe('student count', () => {
  it('keeps today when it already looks complete', async () => {
    const f = reply({ 0: [60, 70, 80] }); vi.stubGlobal('fetch', f);
    expect(await fetchHostelStudents('t', 'H1')).toBe(210); expect(f).toHaveBeenCalledTimes(1);
  });
  it('looks at earlier days when today only had one class marked, and keeps the largest total', async () => {
    const f = reply({ 0: [15], 1: [15, 20], 2: [60, 70, 80], 3: [10] }); vi.stubGlobal('fetch', f);
    expect(await fetchHostelStudents('t', 'H1')).toBe(210);
  });
  it('returns null when the portal has no numbers at all', async () => {
    vi.stubGlobal('fetch', reply({})); expect(await fetchHostelStudents('t', 'H1')).toBeNull();
  });
});
