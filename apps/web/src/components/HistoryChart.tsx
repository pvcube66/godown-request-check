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
  const cols: Col[] = [
    ...(peer !== undefined ? [{ key: 'peer', label: peerLabel, value: peer, kind: 'peer' as const }] : []),
    ...months.map((m) => ({ key: m, label: monthLabel(m, true).replace(/\s\d{4}$/, ''), value: values[m], kind: (m === flagMonth ? 'bad' : 'ok') as 'bad' | 'ok' })),
  ];
  const n = cols.length, W = Math.max(320, n * 88), H = 210, L = 10, R = 10, T = 40, B = 40;
  const plotH = H - T - B, slot = (W - L - R) / n, barW = Math.min(40, slot * 0.58);
  const max = Math.max(1e-9, ...cols.map((c) => c.value ?? 0)) * 1.04;
  const y = (v: number) => T + plotH * (1 - v / max);
  const summary = cols.map((c) => `${c.label}${c.kind === 'bad' ? ' (unusual)' : c.kind === 'peer' ? ' (peer comparison)' : ' (normal)'}, ${c.value === undefined ? 'not asked' : `${num(c.value)}${suffix}`}`).join('; ');

  return (
    <>
    <svg className="hc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${itemName}, month by month: ${summary}.`}>
      <line className="hc-base" x1={L} x2={W - R} y1={T + plotH} y2={T + plotH} />
      {cols.map((c, i) => {
        const cx = L + slot * i + slot / 2;
        const h = c.value === undefined ? 0 : Math.max(4, T + plotH - y(c.value));
        return (
          <g key={c.key} className={`hc-col ${c.kind}`}>
            {c.value === undefined
              ? <text className="hc-none" x={cx} y={T + plotH - 8} textAnchor="middle">not asked</text>
              : <>
                  <rect className="hc-bar" x={cx - barW / 2} y={T + plotH - h} width={barW} height={h} />
                  {c.kind === 'peer' && (
                    // A nested SVG clips the hatch strokes without document-wide pattern IDs.
                    <svg x={cx - barW / 2} y={T + plotH - h} width={barW} height={h} overflow="hidden" aria-hidden="true">
                      <path className="hc-hatch" d={Array.from({ length: Math.ceil((barW + h) / 6) }, (_, j) => `M${j * 6 - h},${h}l${h},${-h}`).join(' ')} />
                    </svg>
                  )}
                  <text className="hc-val" x={cx} y={T + plotH - h - 8} textAnchor="middle">{num(c.value)}{suffix}</text>
                </>}
            <text className="hc-month" x={cx} y={H - 11} textAnchor="middle">{c.label}</text>
          </g>
        );
      })}
    </svg>
    <ul className="hc-nums" aria-hidden="true">
      {cols.map((c) => (
        <li key={c.key} className={c.kind}>
          <span>{c.label}</span>
          <b>{c.value === undefined ? 'not asked' : `${num(c.value)}${suffix ? ` ${suffix.trim()}` : ''}`}</b>
          {c.kind === 'bad' && <em>flagged</em>}
        </li>
      ))}
    </ul>
    </>
  );
}
