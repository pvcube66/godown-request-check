import { monthLabel, num } from '@/lib/format';

type Sev = 'high' | 'medium' | 'low';

/** Picks up to six months around the flagged month so the story is always visible. */
export function windowMonths(all: string[], flagMonth: string): string[] {
  const list = all.includes(flagMonth) ? all : [...all, flagMonth].sort();
  const idx = list.indexOf(flagMonth);
  const end = Math.min(list.length, idx + 3);
  return list.slice(Math.max(0, end - 6), end);
}

/** Month-by-month bars for one item at one hostel. The flagged month is highlighted and a dashed line marks the usual amount. */
export default function HistoryChart({ itemName, months, values, flagMonth, expected, sev }: {
  itemName: string; months: string[]; values: Record<string, number>; flagMonth: string; expected: number; sev: Sev;
}) {
  const W = Math.max(300, months.length * 76), H = 190, L = 10, R = 10, T = 34, B = 32;
  const plotH = H - T - B, slot = (W - L - R) / months.length, barW = Math.min(40, slot * 0.58);
  const vals = months.map((m) => values[m]);
  const max = Math.max(1e-9, expected, ...vals.map((v) => v ?? 0)) * 1.04;
  const y = (v: number) => T + plotH * (1 - v / max);
  const yUsual = y(expected);
  const summary = months.map((m) => `${monthLabel(m, true)} ${values[m] === undefined ? 'no request' : num(values[m]!)}`).join(', ');

  return (
    <svg className="hc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${itemName}, month by month: ${summary}. Usual amount about ${num(expected)}.`}>
      <line className="hc-base" x1={L} x2={W - R} y1={T + plotH} y2={T + plotH} />
      <line className="hc-usual" x1={L} x2={W - R} y1={yUsual} y2={yUsual} />
      {months.map((m, i) => {
        const cx = L + slot * i + slot / 2, v = values[m], isFlag = m === flagMonth;
        const h = v === undefined ? 0 : Math.max(4, T + plotH - y(v));
        return (
          <g key={m} className={isFlag ? `hc-col flag ${sev}` : 'hc-col'}>
            {v === undefined
              ? <text className="hc-none" x={cx} y={T + plotH - 8} textAnchor="middle">no request</text>
              : <>
                  <rect className="hc-bar" x={cx - barW / 2} y={T + plotH - h} width={barW} height={h} rx={5} style={{ animationDelay: `${i * 70}ms` }} />
                  <text className="hc-val" x={cx} y={T + plotH - h - 8} textAnchor="middle">{num(v)}</text>
                </>}
            <text className="hc-month" x={cx} y={H - 10} textAnchor="middle">{monthLabel(m, true).replace(/\s\d{4}$/, '')}</text>
          </g>
        );
      })}
    </svg>
  );
}
