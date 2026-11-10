/** Same as the dashboard hostel label (kept in sync with apps/web/src/lib/format.ts). Used in WhatsApp text: "36260501312-KGBV MALDAKAL" -> "KGBV Maldakal" */
const ACRONYMS = new Set(['KGBV', 'TGMREIS', 'MJPTBCW', 'TGSWREIS', 'TGTWREIS', 'RDC', 'TW', 'SW', 'BC', 'SC', 'ST', 'APTWREIS', 'II', 'III']);

export function hostelLabel(name: string): string {
  const noCode = name.replace(/^\d+\s*-\s*/, '');
  return noCode.split(/\s+/).map((w) => {
    const core = w.replace(/[^A-Za-z]/g, '');
    if (ACRONYMS.has(core.toUpperCase())) return w.toUpperCase();
    return w.toLowerCase().replace(/[a-z]/, (ch) => ch.toUpperCase());   // handles "(girls)" -> "(Girls)"
  }).join(' ');
}
