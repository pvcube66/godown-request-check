const ACRONYMS = new Set(['KGBV', 'TGMREIS', 'MJPTBCW', 'TGSWREIS', 'TGTWREIS', 'RDC', 'TW', 'SW', 'BC', 'SC', 'ST', 'APTWREIS', 'II', 'III']);

/** "36260501312-KGBV MALDAKAL" -> "KGBV Maldakal" */
export function hostelLabel(name: string): string {
  const noCode = name.replace(/^\d+\s*-\s*/, '');
  return noCode.split(/\s+/).map((w) => {
    const core = w.replace(/[^A-Za-z]/g, '');
    if (ACRONYMS.has(core.toUpperCase())) return w.toUpperCase();
    return w.toLowerCase().replace(/[a-z]/, (ch) => ch.toUpperCase());   // handles "(girls)" -> "(Girls)"
  }).join(' ');
}

/** "IddliRavva" -> "Iddli Ravva" */
export const itemLabel = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').trim();

export function num(n: number): string {
  if (n > 0 && n < 1) return n < 0.1 ? 'less than 0.1' : n.toFixed(1);
  const d = n >= 10 || Number.isInteger(n) ? 0 : 1;
  return n.toLocaleString('en-IN', { maximumFractionDigits: d });
}

export function monthLabel(m: string, short = false): string {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-IN', { month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' });
}

/** 120.3 -> "about 120 times more" */
export function timesMore(ratio: number): string {
  if (ratio < 1.5) return 'a little more';
  const r = ratio >= 100 ? Math.round(ratio / 10) * 10 : ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 2) / 2;
  return `about ${r.toLocaleString('en-IN')} times more`;
}

export const SEVERITY = {
  high: { label: 'Check now', hint: 'Far more than normal. Please look at these first', cls: 'high' },
  medium: { label: 'Take a look', hint: 'Noticeably more than normal. Please look at these next', cls: 'medium' },
  low: { label: 'Minor', hint: 'A little more than normal. For your information, no rush', cls: 'low' },
} as const;

export function ago(d?: Date | null): string {
  if (!d) return 'never';
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins > 1 ? 's' : ''} ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const days = Math.round(h / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export const when = (d?: Date | null) =>
  d ? d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '—';

export const IMPORTANCE = { high: 'Check now', medium: 'Take a look', low: 'Minor' } as const;
export const METHOD_TEXT = {
  'own-history': "Compared with this hostel's earlier months.",
  peers: 'Compared with similar hostels (no earlier months to use).',
  blend: 'Compared with earlier months and similar hostels.',
} as const;

/** The sentence shown across the top of every card, so nobody has to understand a colour or an icon. */
export const BANNER = {
  high: { label: 'Check now', text: 'This is far more than normal. Please look at this first.' },
  medium: { label: 'Take a look', text: 'This is noticeably more than normal. Please look at this when you can.' },
  low: { label: 'Minor', text: 'This is a little more than normal. It is only for your information, there is no rush.' },
} as const;
