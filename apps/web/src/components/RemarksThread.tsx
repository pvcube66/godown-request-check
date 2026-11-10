import type { RemarkDoc } from '@anomaly/core';
import { OUTCOME_TEXT } from '@anomaly/core';
import { when } from '@/lib/format';

/** Remarks on an order or an issue, oldest first. */
export default function RemarksThread({ remarks }: { remarks: RemarkDoc[] }) {
  if (remarks.length === 0) return <p className="mut small">No remarks yet.</p>;
  return (
    <ul className="remarks">
      {remarks.map((r, i) => (
        <li key={i}>
          <div><b>{r.authorName}</b> <span className="mut small">· {when(r.at)}{r.outcome ? ` · ${OUTCOME_TEXT[r.outcome]}` : ''}</span></div>
          <p>{r.text}</p>
        </li>
      ))}
    </ul>
  );
}
