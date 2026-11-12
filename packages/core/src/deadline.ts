/** A soft time limit for the catch-up steps of a check, so a short-lived host (a website function that is stopped after a minute or so) can finish.
 *  The core steps (reading this month's requests, finding unusual ones) are never cut short; only the optional, resumable ones stop early and
 *  simply continue on the next check. Only one check runs at a time, so one shared value is enough. */
let until: number | undefined;
export const setDeadline = (atMs: number | undefined) => { until = atMs; };
export const outOfTime = () => until !== undefined && Date.now() > until;
