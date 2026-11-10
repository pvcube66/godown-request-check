# Acceptance checklist

Tick each line with real data before go-live. "Auto" lines are covered by `npm test` or `scripts/acceptance/` (see its README); the rest need a person and a browser.
Nothing below needs the government portal to be written to, and nothing should be: if something seems to need that, stop and ask.

## Before anything
- [ ] Client has confirmed the requirement list (plan, section 1) and the numbers in section 3.
- [ ] Old passwords that were pasted into chat are replaced (portal logins, database, dashboard password, any WhatsApp key).
- [ ] Hosting details received (only then start Phase 10 moving the system).

## Phase 2: logins and districts
- [ ] Auto: an operator, a viewer and an admin see exactly their districts on every page, search, download and direct link.
- [ ] Create a real operator with 3 districts in Users; sign in as them; confirm nothing from other districts anywhere (also in the browser's address bar by typing another hostel's link).
- [ ] Turn that login off; the next click sends them to sign-in.
- [ ] Five wrong passwords lock the login for 15 minutes; an administrator's password reset unlocks it.
- [ ] The emergency login (`admin` + dashboard password) works, and its use shows in Recent activity.

## Phase 3: look, search
- [ ] Black-and-white look on every page; colour only on alerts, overdue counts, green Acknowledged date, errors.
- [ ] Print a report in black and white: urgent items still read as urgent (words, not colour).
- [ ] Search from every page finds a hostel by full name, part of a name, and code; and an order by request ID.

## Phase 1: master data
- [ ] Import the client's mapping sheet (all 33 districts, 18 godowns, 8 suppliers). A deliberately wrong copy changes nothing.
- [ ] Re-assign one district on a chosen date; both periods stay in history; the hostel page shows today's supplier.
- [ ] Item units show for items; a corrected unit shows a change in the log.

## Phase 4: issues
- [ ] Raise an issue from a flag with a reason; it appears in Issues as "Not rejected on the portal yet".
- [ ] Reject that indent on the real portal yourself; within the hour it moves to "Waiting for a new indent".
- [ ] A new indent for the same hostel and month moves it to "Resolved" and links it.
- [ ] With no new indent, it shows Overdue after the set number of days (default 2) on Issues and on the first page.
- [ ] Flag an order by hand; add a remark with a call result; close an issue with a note.

## Phase 5: stages and dashboards
- [ ] Days count only in Pending, DC Generated, In-Transit, Variation. Acknowledge shows a green date and no days. Rejected/Cancelled show "final".
- [ ] Dashboards: Overall, District-wise, Godown-wise; click a number and the list has that many orders.
- [ ] The stage totals match the portal's own totals for the same godown login and month (compare the portal screen with Order tracking tabs).
- [ ] Every Excel download opens in Excel with the right characters; the full copy (Full copy page) has all orders, flags, issues and remarks.

## Phase 6: hostel page
- [ ] From search, two clicks reach a hostel; godown and hostel in-charge numbers can be tapped to call.
- [ ] Month picker: a month with no indent says so; a month with one shows stages, items with units, and the comparison with earlier months.

## Phase 7: suppliers
- [ ] The Supplier page names real suppliers (the portal names them once a delivery note exists) and the order counts match Order tracking.
- [ ] A supplier's "Meeting demand?" verdict makes sense for two suppliers you know (check one order's "Supplied against requested").
- [ ] Confirm the limits (90% supplied, 10% of open orders waiting 15+ days) with the client.

## Phase 8: WhatsApp (only after the client's Meta details arrive)
- [ ] Settings saved; template submitted and shown as APPROVED; webhook verified in Meta.
- [ ] Preview mode for a few days: the list of who would be messaged matches reality.
- [ ] Live with ONE team phone as the only hostel number: the message arrives, ticks update on the order, reminder 2 arrives on schedule, and nothing arrives after the order is acknowledged.
- [ ] Reply STOP from the test phone: the hostel shows as opted out and nothing more is sent.

## Phase 10 / 11: running it
- [ ] `/api/health` answers 200; stop the hourly job for 2 hours in a test and see it answer 503 and the red bar on the first page.
- [ ] A backup (`scripts/backup.sh`) is made and a restore into an empty database opens correctly.
- [ ] The hourly job runs unattended for 3 days.
- [ ] Training done (docs/training-guide.md); first-week daily check done.
