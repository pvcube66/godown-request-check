import { monthLabel, num } from '@/lib/format';

/** Picks up to six months around the flagged month so the story is always visible. */
export function windowMonths(all: string[], flagMonth: string): string[] {
  const list = all.includes(flagMonth) ? all : [...all, flagMonth].sort();
  const idx = list.indexOf(flagMonth);
  const end = Math.min(list.length, idx + 3);
  return list.slice(Math.max(0, end - 6), end);
}

/**
 * One bar per month: grey = normal, black = unusual, outlined hatching = peers.
 * When the hostel has no earlier months, `peer` adds a labelled bar for what other hostels ask,
 * so the "usual" number is always visible and never has to be explained.
 */
export default function HistoryChart({ itemName, months, values, flagMonth, peer, suffix = '', peerLabel = 'Similar hostels' }: {
  itemName: string; months: string[]; values: Record<string, number>; flagMonth: string; peer?: number; suffix?: string; peerLabel?: string;
}) {
  type Col = { key: string; label: string; value: number | undefined; kind: 'peer' | 'ok' | 'bad' };
  // At most four months (the flagged one and its neighbours) plus the similar-hostels bar, so every label stays large enough to read.
  const flagAt = Math.max(0, months.indexOf(flagMonth));
  const start = Math.max(0, Math.min(flagAt - 1, months.length - 4));
  const shownMonths = months.slice(start, start + 4);
  const cols: Col[] = [
    ...(peer !== undefined ? [{ key: 'peer', label: peerLabel, value: peer, kind: 'peer' as const }] : []),
    ...shownMonths.map((m) => ({ key: m, label: monthLabel(m, true).replace(/\s\d{4}$/, ''), value: values[m], kind: (m === flagMonth ? 'bad' : 'ok') as 'bad' | 'ok' })),
  ];
  const max = Math.max(1e-9, ...cols.map((c) => c.value ?? 0));
  const summary = cols.map((c) => `${c.label}${c.kind === 'bad' ? ' (unusual)' : c.kind === 'peer' ? ' (peer comparison)' : ' (normal)'}, ${c.value === undefined ? 'not asked' : `${num(c.value)}${suffix}`}`).join('; ');

  return (
    <div className="hc2" role="img" aria-label={`${itemName}, month by month: ${summary}.`} style={{ ['--cols' as string]: cols.length }}>
      {cols.map((c) => (
        <div key={c.key} className={`hc2-col ${c.kind}`}>
          <span className="hc2-val">{c.value === undefined ? <em>not asked</em> : <>{num(c.value)}<small>{suffix}</small></>}</span>
          <span className="hc2-track"><i className="hc2-bar" style={{ height: c.value === undefined ? 0 : `${Math.max(4, (c.value / max) * 100)}%` }} /></span>
          <span className="hc2-lab">{c.label}{c.kind === 'bad' && <b>flagged</b>}</span>
        </div>
      ))}
    </div>
  );
}
