import Link from 'next/link';
import { cancellationCheck, reviewStats, type ReviewGroup } from '@anomaly/core';
import { hostelLabel, monthLabel, num } from '@/lib/format';
import { Icon } from '@/components/Icons';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'How accurate is it?' };
const ENOUGH_OVERALL = 10, ENOUGH_GROUP = 20;

function Row({ g }: { g: ReviewGroup }) {
  const pct = Math.round((100 * g.realProblems) / Math.max(1, g.reviewed));
  return (
    <div className="acc-row">
      <div className="acc-label"><b>{g.label}</b><span className="mut">{g.reviewed} reviewed{g.reviewed < ENOUGH_GROUP ? ', too few to be sure yet' : ''}</span></div>
      <div className="acc-bar" role="img" aria-label={`${g.realProblems} real problems and ${g.falseAlarms} false alarms`}>
        <i className="real" style={{ width: `${(100 * g.realProblems) / g.reviewed}%` }} /><i className="fake" style={{ width: `${(100 * g.falseAlarms) / g.reviewed}%` }} />
      </div>
      <div className="acc-num"><b>{pct}%</b><span className="mut">{g.realProblems} of {g.reviewed} were real</span></div>
    </div>
  );
}

export default async function Accuracy() {
  const c = await getDb();
  const [r, cancelled] = await Promise.all([reviewStats(c), cancellationCheck(c)]);
  const caught = cancelled.filter((x) => x.flagged).length;
  const pct = Math.round((100 * r.realProblems) / Math.max(1, r.reviewed));
  return (
    <>
      <div className="hero">
        <h1>How accurate is the detector?</h1>
        <p className="lede">Every time someone marks a flag as <b>“This looks wrong”</b> or <b>“This is fine”</b>, we learn whether it was a real problem. This page turns those clicks into an accuracy figure.</p>
      </div>

      {cancelled.length > 0 && (
        <section aria-labelledby="real-cancellations" style={{ marginBottom: 32 }}>
          <h2 className="sub" id="real-cancellations" style={{ marginTop: 0 }}>Checked against real cancellations</h2>
          <p className="lede small">The portal itself records requests that hostel staff cancelled, with the reason they wrote. These are real mistakes. We re-ran the detector as if each one were still waiting to be delivered, to see whether it would have been flagged in time.</p>
          <div className="summary" style={{ marginBottom: 14 }}>
            <h2>{caught} of {cancelled.length} cancelled requests would have been flagged</h2>
            <p className="sub-lede">Some cancellations are for reasons that have nothing to do with the amounts, so a miss is not always a mistake by the detector.</p>
          </div>
          <div className="list">
            {cancelled.map((x) => (
              <div className="row cancel" key={x.requestId}>
                <div>
                  <h3>{hostelLabel(x.hostelName)}</h3>
                  <p className="meta">{x.requestId}, {monthLabel(x.month)}. {x.items} items, total {num(x.total)}.</p>
                  <p className="reason">{x.reason ? <>Reason given: “{x.reason.length > 150 ? `${x.reason.slice(0, 150)}…` : x.reason}”</> : 'No reason was written.'}</p>
                </div>
                <span className={`state ${x.flagged ? 'ok' : 'bad'}`}>{x.flagged ? <><Icon name="check" size={15} />Would have been flagged</> : 'Not flagged'}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <h2 className="sub" style={{ marginTop: cancelled.length ? 8 : 0 }}>From people's review clicks</h2>
      {r.reviewed < ENOUGH_OVERALL ? (
        <div className="empty">
          <h2>Not enough reviews yet</h2>
          <p>{r.reviewed === 0 ? 'No flags have been reviewed so far.' : `Only ${r.reviewed} flag${r.reviewed > 1 ? 's have' : ' has'} been reviewed so far.`} Mark a few flags as “This looks wrong” or “This is fine” and the figures will appear here. About 30 reviews gives a first reliable picture.</p>
          <Link className="btn" href="/">Go to the flagged requests</Link>
        </div>
      ) : (
        <>
          <section className="summary" aria-label="Overall">
            <h2>{pct}% of reviewed flags were real problems</h2>
            <p className="sub-lede">{r.reviewed} flags were reviewed. <b>{r.realProblems}</b> were real problems and <b>{r.falseAlarms}</b> were false alarms.</p>
          </section>
          <h2 className="sub">By how serious the flag was</h2>
          <div className="acc">{r.bySeverity.map((g) => <Row key={g.label} g={g} />)}</div>
          <h2 className="sub">By kind of mistake</h2>
          <div className="acc">{r.byKind.map((g) => <Row key={g.label} g={g} />)}</div>
          <h2 className="sub">By how the comparison was made</h2>
          <div className="acc">{r.byBasis.map((g) => <Row key={g.label} g={g} />)}</div>
          <ul className="key" style={{ marginTop: 16 }}><li><i className="k-bad" />Real problem (marked “This looks wrong”)</li><li><i className="k-ok" />False alarm (marked “This is fine” or “Normal for this hostel”)</li></ul>
        </>
      )}
    </>
  );
}
