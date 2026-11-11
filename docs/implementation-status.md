# Phase-wise implementation status

## Authorization and boundaries

On 10 November 2026 the project owner explicitly authorized local, phase-wise implementation. This authorizes local development; it does **not** record the client's requirements sign-off or permission to deploy. D10 remains a release/sign-off follow-up, not a reason to block the locally authorized work.

- Government portal access remains read-only. No new portal calls or writes were introduced.
- No production deployment, database migration, secret rotation, or WhatsApp send was performed.
- No student-level data was introduced.
- Client Meta setup, hosting details, mapping data, and operator list remain external inputs. Do not mark Phase 0 completed on the basis of local code changes.

## Release 0 — Phase 3 local implementation

**Status:** implemented locally; automated validation passed; browser/print acceptance pending.

### Delivered

- Black-and-white ledger theme using the Phase 3 tokens, existing Figtree font, 20 px page titles, 15 px section headings, and 13.5 px body/table text.
- Black navigation, white pages, compact controls/tables, sticky order headers, and monochrome login/branding.
- Labelled severity tags and system/overdue status retain limited alert colour; ordinary charts, comparisons, buttons, and backgrounds are monochrome.
- Persisted Compact / Comfortable density setting in the shared application header. Compact is the default. If local storage is unavailable the control still works for the mounted session.
- Collapsed hostel tiles show hostel name, code, district, issue types, severity, and issue count. Native details controls open the comparisons/charts/actions; no review action is hidden inside a clickable link.
- Collapsed overview panels reduce page height without deleting the existing charts or start-here guidance.
- History charts use grey normal bars, black unusual bars, and outlined/hatched peers. Accessible chart summaries identify unusual values without relying on colour.
- Global header search on every authenticated dashboard page. `/search` searches stored hostel names, codes, and request IDs, with literal case-insensitive substring matching and a maximum 60-character query.
- Search hostels are deduplicated by godown and hostel code. Each result section is limited to 20 entries, with explicit notices when there are more. Order tracking uses the same matching rules for follow-through.
- `/search` uses the existing session-protected proxy. Before Phase 2, it intentionally searches across all districts, as specified by Phase 3. District-scoped database queries are **not implemented yet**.

### Validation performed

- `npm test`: **64 tests passed**, including 15 new search/order-filter tests.
- `npm run typecheck`: core and worker passed.
- `npx tsc -p apps/web --noEmit`: passed.
- `npm -w apps/web run build`: passed, including the new dynamic `/search` route.
- Shell server-render smoke using React and Next's pathname context: shared search, compact default, and density control rendered successfully.
- `git diff --check`: passed.

No live portal or database was used for these checks. Tests of query assembly use mocked collections; they are not a real MongoDB integration test. No browser tooling is installed, so screenshots, interactive density persistence, mobile layout, print output, and the target “2–3× more records per screen” are not yet visually verified.

### Local acceptance checklist

Run `npm -w apps/web run dev` with the usual locally configured dashboard/database environment, then:

1. Log in. Check Unusual requests, Orders, Godowns, Past checks, hostel/order details, report, and search at desktop and mobile widths.
2. On Unusual requests, verify all eight hostel tiles are initially collapsed and expose name/code/issue types. Expand with both mouse and keyboard; confirm charts and existing review actions still work.
3. Toggle Comfortable, navigate, and refresh. Confirm the selection persists. Repeat with local storage blocked; the toggle should still work in the current mounted session.
4. Search for a full hostel name, mixed-case partial name, full/partial hostel code, and request ID. Verify destination profiles/orders. Search punctuation such as `.*` and confirm it is literal, not a wildcard.
5. Search a broad prefix with more than 20 orders. Follow “See all matching orders” and verify matching codes remain in the results.
6. With no session, request `/search?q=test`; expect the existing login redirect.
7. Print a report in black and white. Verify unusual/peer chart bars remain distinguishable and tags still carry urgency words.
8. Check keyboard focus on black navigation and toast controls. Confirm no decorative colour remains and acknowledged-date/day-count behaviour is checked again when Phase 5 implements those rules.

## Phase 1 — Master data

**Status:** implementation complete locally; automated validation passed. Client-data, real Mongo transaction, and browser acceptance remain pending. Stop here: no Phase 2 work is authorized by this implementation pass.

### Delivered

- Typed/indexed district, godown, supplier, dated mapping, hostel master, item master and audit collections.
- Master data screen at `/master`, with stored-data bootstrap, mapping history, district reassignment, item corrections, editable business contacts and change log.
- CSV/XLSX import matching sheet `1 Mapping` in the supplied template. All rows validate before transactional writes. Sample rows, invalid dates, ambiguous godowns, overlapping assignments and contradictory supplier assignments are rejected. Exact repeat imports do not rewrite history.
- Calendar intervals are **[from, to)**: the end date is excluded. Reassignment preserves prior history and future scheduled assignments. UI explicitly explains this convention.
- Mapping operations lock district/godown records inside retryable Mongo transactions; history and audit commit together. These operations require MongoDB Atlas or another **replica set**—a standalone Mongo server is not sufficient. No non-atomic fallback is used.
- Administrator bootstrap reads already stored accounts/requests, not the government portal. It creates no invented mappings, supplier assignments or godown IDs.
- New verified portal accounts create their godown master records and prompt the administrator to assign districts under Master data.
- Item metadata hydration uses only the existing read-only items endpoint. Up to 40 requests per account per sync are hydrated, with rate limiting. Successful empty reads are recorded, transient failures remain retryable, and authentication failures propagate.
- Units, pack sizes, brand/category and supplied/received quantities are retained as item snapshots. Raw report quantities remain intact. Unknown or ambiguous units are explicitly unknown, never guessed.
- Detection and history comparisons distinguish unit/pack variants (including 200 g vs 250 g). Known units do not borrow unknown legacy history; no kg-to-packet conversion is inferred. This can temporarily reduce comparison coverage while metadata backfills.
- Item master corrections are stored separately from observed identity and displayed on order details. They do not silently rewrite historical order snapshots or detector identities.
- Hostel pages resolve today's dated godown/supplier assignment and expose recorded business contacts. Full month-picker workflow remains Phase 6.

### Temporary administrator boundary (replaced in Phase 2, see below)

Until Phase 2 introduces individual users/roles, configure **`MASTER_ADMIN_PASSWORD`**, at least 16 characters and different from `DASHBOARD_PASSWORD`. Set the value in your environment/secret store, never in source control. Restart the app, log into the existing dashboard and unlock `/master`.

The admin unlock is a separate HttpOnly, SameSite cookie, expires after one hour, and is cryptographically bound to the existing dashboard session. Missing/invalid configuration fails closed. Master reads, every master mutation and godown account management require the additional gate. Audit actor is `master-admin`, not a fabricated individual user. This is **not** district-scoped operator access; that remains Phase 2.

### Validation and limitations

- Unit/action/import/security tests, core/worker/web TypeScript checks, and the web production build passed. Tests include real generated XLSX workbooks and the supplied template's required rejection of its sample row.
- Mapping transaction tests use mocks; no production database migration, bootstrap/import, portal sync, or WhatsApp call was run for validation.
- Browser/mobile/print acceptance remains pending because browser tooling is unavailable.
- The live detector benchmark was not run: its CLI connects to Mongo and ensures indexes. Mixed-unit/pack-size detector regression tests were run instead.
- ExcelJS is used only on the server. XLSX parsing bounds compressed size, actual expanded sizes, ZIP entries and worksheet dimensions, and rejects formulas/hyperlinks. The ExcelJS UUID dependency is overridden to patched 11.1.1. npm audit still reports the existing worker `node-cron`/UUID moderate advisory; no unrelated cron upgrade was made.

### Local acceptance

1. Configure the separate admin secret and a replica-set Mongo database; unlock `/master`.
2. Bootstrap stored data, replace the template's sample row with real mappings and import. Verify invalid/overlapping files leave no partial changes.
3. Reimport the same file; expect skipped rows. Reassign a district on a chosen date; verify both history intervals and the hostel's current supplier.
4. Run the normal worker sync when authorized; verify item metadata/contacts appear incrementally. Unknown/ambiguous units must remain labelled unknown.
5. Correct a business contact/item display field; verify the change log and hostel/order view. Lock master access; direct actions and account management must be denied.

Release 0 was committed as `69128de` and merged through [PR #1](https://github.com/pvcube66/godown-request-check/pull/1), merge commit `092d4ae`. Phase 1 is isolated on `phase-1-master-data` for its own PR.

Later phases remain unimplemented. Phase 9 stays removed; Phase 10 stays parked pending hosting details. No WhatsApp implementation may fabricate the required TELECRM source or reuse its secrets.


## Phase 2 — Users, roles and district-wise access

**Status:** implemented locally; unit tests, a real-MongoDB scoping check and the production build passed. Browser acceptance pending.

### Delivered

- `users` collection (name, phone, email, role, district codes, scrypt password hash, status, lockout counters). Roles: **admin** (everything, all districts), **operator** (works on chosen districts), **viewer** (reads chosen districts, cannot change anything).
- Sign-in with email and password. Five wrong passwords lock that login for 15 minutes (an admin can unlock by resetting the password or turning it off and on). Unknown email and wrong password give the same answer and the same amount of work.
- **Emergency (break-glass) admin:** type `admin` as the email and use `DASHBOARD_PASSWORD`. Use it to create the first real administrator, then keep it for emergencies. `MASTER_ADMIN_PASSWORD` is no longer used; Master data, Godowns, Users, Past checks and Accuracy are administrator-only by role.
- Session cookie carries only a user id and expiry, signed. Every page, action and download checks the database on each request, so turning someone off takes effect at once.
- **District limit is in the database query** for: Unusual requests (list, counts, district/month pickers), hostel page, orders list/counts/month picker/detail/Excel, report page and Excel, search, and the "this looks wrong / fine" action (a flag from another district cannot be changed even if its key is sent). A guessed link to another district's hostel or order shows "not found". An operator with no districts sees nothing.
- Admin screen `/users`: add a person, change role/districts, set a new password, turn a login on or off, never leaving zero active admins. Recent-activity table shows sign-ins, failed sign-ins, downloads, user changes and flag decisions.
- Audit log entries for logins, logouts, failed logins, user changes, exports and flag decisions.

### Not done / limits

- WhatsApp login code (R8) is optional and waits for Phase 8.
- District membership is matched on the district name the portal gives (case and spacing ignored). If the portal renames a district, the admin must re-assign it.
- Tests of page rendering use mocks; real browser checks of each role are pending.


## Phase 4 — Issue workflow, remarks, manual flags, indent view

**Status:** implemented locally; unit tests, a real-MongoDB workflow check, a production build and a local server render check passed. Browser clicking of the buttons is pending.

### Delivered

- The two review buttons are now **Issue (reject this indent)** and **Fine**, with plain wording. Issue asks "What is wrong?" (required) and says it only records the issue here. The "normal for this hostel" button and the "learning" wording are gone. Old data keeps working (an old "marked wrong" flag says so).
- **Issues** (`issues` collection, page `/issues`, page per issue). States: raised → rejected on portal → resolved (new indent came in), or closed by hand with a note. **We never write to the portal** (decision D3): the operator rejects on the real portal; the hourly check (`syncIssues`, run after every detection pass) sees the rejection from our stored copy of the portal data, starts the wait, and links the new indent when a request for the same hostel and month appears that we had not seen before.
- **Alert:** an issue waiting for a new indent for N whole India calendar days (default 2, an admin setting on the Issues page, 1 to 30) shows as overdue on the Issues page and as a bar on the first page.
- **Manual flag:** any order page has "Flag this order" (operators and admins). It joins the same workflow.
- **Remarks:** a remarks thread with author, date-time and an optional call result on every issue and every order; the hostel page lists that hostel's issues.
- **Indent view with units:** the issue page shows the full item list of the wrong indent (and the new one) with unit and pack size, highlighting the flagged items. The order page uses the same list.
- All of it respects district limits and roles (viewers are read-only). Every raise, close and remark is in the audit log.

### Behaviour worth knowing

- Several flags for the same hostel and month join one open issue (a remark is added).
- "Rejected" means the portal status of one of the issue's target requests starts with Reject or Cancel (in the requests report or the orders feed). If every request was already rejected when the issue is raised, the wait starts at once.
- "New indent" = a live request for the same hostel and month that **we first saw after the issue was raised**. A request that arrives earlier than our hourly read could not be told apart, so it is matched at the next read.

### Not done / limits

- WhatsApp to the operator for overdue issues is optional and left for Phase 8.
- The button flow is tested with mocked database calls and, for the core logic, against a real local MongoDB; the buttons were not clicked in a real browser.


## Phase 5 — Stage rules and dashboards

**Status:** implemented locally; unit tests, a production build and a local server render check (seeded test data, local MongoDB) passed. Not yet checked against the live portal totals or in a browser.

### Delivered

- **Counting rules (R27, R28, D4).** Days are counted only while an order is Pending, DC Generated, In-Transit or in Variation. Acknowledge stops the count and shows its date in green. Rejected and Cancelled are final actions with a date (or "first seen by us") and no day count. Applies to the Order tracking table, the order timeline, the stage columns and the Excel download.
- **Dashboards** (`/dashboards`): an **Overall** view (orders and hostels per stage), a **District-wise** view and a **Godown-wise** view (orders per stage, hostels, total, and how many are stuck 7+ and 15+ days). Every number opens the matching orders. Month filter. **Download Excel** on every view, with a totals row.
- **"Stuck" thresholds** are 7+ days and 15+ days at the same open stage, matching the amber and red shading on Order tracking, so the dashboard counts equal what the table shows in colour. (The plan wrote "over 7 and 14 days"; "over 14 days" is the same as 15+.)
- **Order tracking** can now also be filtered by district, godown and stuck days (from the dashboards), shows an **Issue type** column (open issue, waiting for a new indent, or the kind of unusual-request flag) next to hostel name and code (R29), and the stage-tab counts follow the district and godown filter. The "All" tab is now first, as asked earlier.
- **Full copy (R4):** `/exports` (administrators only) downloads Excel files of all orders, all unusual-request flags, all issues and all remarks. Every download is in the audit log. Spreadsheet formulas typed into remarks or names are neutralised in all downloads.
- All views and downloads respect the person's districts.

### Notes

- "Hostels" counts hostels with at least one order in the row, not the hostel master list (which needs the client's mapping data).
- Totals on every view come from the same stored orders as the Order tracking tabs, so they agree by construction. A comparison with the portal's own page totals needs a live read and was not done here.


## Phase 6 — Hostel drill-down

**Status:** implemented locally; unit tests, a production build and a local server render check (seeded test data) passed. Browser check pending.

### Delivered (all on the existing hostel page, reached from search in two clicks)

- Header facts: hostel name, code, district, student count, assigned godown and supplier (dated mapping from Phase 1), godown in-charge and hostel in-charge numbers as tap-to-call links.
- **Needs attention now:** the hostel's issues (state, number of remarks, the latest remark), orders that have waited 7+ days at an open stage (amber/red wording), and a jump link to the unusual-request cards.
- **Indent history by month:** a month picker that includes months with no indent ("No indent came for November 2026. The hostel skipped this month."). For a month with an indent: each request with its status, placed date, current stage and days (Phase 5 counting rules), a compact stage timeline, and a table of each item with unit and pack size, this month's quantity, the average of the hostel's own earlier months, and plain words for how it compares ("10.0 times the usual", "about the usual"). Months whose indents were all rejected say so instead of comparing.
- Links to each order. **WhatsApp history** links arrive with Phase 8.
- District limits apply to everything on the page (a hostel outside the person's districts shows "not found").

### Notes

- "Earlier months" are only months in which the hostel placed a request; rejected indents are not counted, as elsewhere.
- Units show "Unknown" until the item master has them for that item (never guessed).


## Phase 7 — Supplier performance

**Status:** implemented locally; unit tests, a real-MongoDB check of the portal-read step (with a stand-in reader), a production build and a local server render check (seeded data) passed. **No live portal read of the item lists was made.**

### Delivered

- **Supplied and received quantities** (`fulfilment` on each order). For every order that has a delivery note (DC Generated, In-Transit, Acknowledge, Variation) the hourly check reads the portal's item list (read-only, the same endpoint as before) and stores a small summary: for each item, supplied against asked for, received against supplied, lines with a variation, and the items supplied short. It is re-read only when the order's stage changes. At most 120 orders per godown login per hour with a pause between calls, so the first catch-up takes a few hours. Failures are retried; a rejected login stops the step and shows in the run log.
- **Never adds across units.** Each item is compared with itself ("supplied ÷ asked for", capped at 100%) and the items are averaged. Orders still Pending are not "short" because nothing has been supplied yet.
- **Supplier performance page** (`/suppliers`): Supplier view, Godown, District and Hostel view. For each row: orders, supplied %, received %, days to DC, DC to dispatch, dispatch to acknowledge (the portal's own dates), open orders and how many are 7+ and 15+ days old, rejected share, variation share, the difference from the average of everyone in view, and **Meeting demand?** (Meeting / Watch / Not meeting / Not enough data) with the limits written on the page (90% supplied and under 10% of open orders waiting 15+ days to meet; under 75% supplied or over 25% waiting 15+ days to fail). The weakest are listed first.
- **Supplier attribution** uses the dated district-to-supplier mapping (Phase 1) at the day the order was placed, so re-assigning a district does not rewrite history. Until the client's mapping sheet is imported, orders show as "No supplier mapped yet" and the page says so; Godown and District views work from day one.
- **Click through:** a row opens its own page view with its districts (weakest first), how many hostels were served in full, were short, or are still waiting, and the 15 weakest hostels. Order counts link to the matching orders (so the numbers reconcile with the orders list).
- **Month-by-month checkpoint** per supplier (by month placed) with the numbers behind each verdict.
- **Excel download** for every view; the order page now shows "Supplied against requested" with the items supplied short and their units.
- District limits and the audit log apply as everywhere else.

### Notes and limits

- The meeting-demand limits are our starting values, not the client's. They are constants in one place (`MEETING` in the web library) and should be confirmed with the client.
- Dispatch and DC dates on the portal are often the same day, so "DC to dispatch" may read 0.
- Until the hourly job has read the item lists, the page shows how many orders are covered ("read for X of Y").


## Phase 8 — WhatsApp reminders

**Status:** implemented locally and **sending is off**. Unit tests, a real-MongoDB run of the whole reminder and webhook flow using a **stand-in sender** (no message was sent to anyone and WhatsApp/Meta was never contacted), a production build and a local server check passed. **Nothing has been tested against the real WhatsApp service**: that needs the client's own Meta details (D7), which have not arrived.

### Delivered

- **Reminder rules (D9):** an order In-Transit and not acknowledged after **3 days** gets a first reminder, then one every **2 days**, up to **4**, **one message per hostel per day** (the longest-waiting order of that hostel is the one reminded), and it **stops at once** when the order is Acknowledged, Rejected or Cancelled, or the hostel replied STOP. All numbers are settings on the new admin page `/whatsapp`.
- **Sending hours:** none. Reminders can go out at any time of day, as the client's rules say.
- **Three modes:** Off; **Preview only** (the default: works out who would be messaged and shows the exact message, sends and stores nothing); Live. Live cannot be switched on until the phone number ID, business account ID, access key and app secret are saved **and WhatsApp has approved the template**. If the template later stops being approved, sending falls back to preview.
- **Reminder wording** is the approved template from `docs/templates/whatsapp-reminder-template.md`; only the last sentence changes with the reminder number. The page can submit it to Meta for approval and check its status.
- **Safety:** each reminder has a unique key, so two overlapping runs can never send the same reminder twice; a refused send (for example an expired access key) stops the run, is shown in plain English on the page, does not use up a reminder, and is retried the next hour; numbers must be valid 10-digit Indian mobiles; only the last four digits of a phone number are kept in the history and shown; the access key and app secret are stored encrypted and never shown or written to the change log; every settings change is logged.
- **History on the order (R31):** each reminder with its number, time and delivery state in words (Sent, Delivered, Read, Failed with a plain-English reason) plus replies, on the order page and the hostel page.
- **Webhook** `/api/whatsapp/webhook` receives delivery ticks and replies. Setup steps and the verify token are shown on the WhatsApp page. A reply of STOP records an opt-out for that hostel; staff can also record or undo an opt-out on the hostel page.
- Everything that needs sign-in is still protected; the webhook is the only address without sign-in and is protected by Meta's signature instead.

### What was reused from TELECRM `crm_server` (as the owner asked), and what was deliberately not

- **Reused, rewritten in TypeScript for one company:** Graph API v24.0 template send, template create, template status; the setup handshake (verify token / challenge); the plain-English error list (`metaErrorCopy`, same codes, wording changed because there is no "Retry Failed" button here); the repeat-delivery guard on status updates.
- **Improved instead of copied:** the CRM accepts a webhook **with no signature** outside production and compares signatures in a way that leaks timing. Here every request must be signed with the app secret (constant-time check), and none is accepted before the secret is saved. The CRM's status guard only checks "different from stored", so a late "sent" can overwrite "read"; here statuses only move forward.
- **Not copied:** flows, campaigns, groups, commerce, automations, analytics, live chat, media hosting, multi-company logic, and **none** of the CRM's keys, tokens or `.env` files.

### Needed before going live

1. The client's Meta details: phone number ID, business account ID, a permanent access key, the app secret.
2. Fill them in on `/whatsapp`, set up the webhook in Meta with the URL and verify token shown there, submit the wording for approval, and check approval.
3. Keep Preview on for a few days and compare the list with reality, then switch to Live with a test phone first. The hostel phone numbers used are the ones the portal gives (`mobile`) or an administrator entered under Master data.
4. Confirm with the client the hours and the numbers in the rules.

### Notes and limits

- Delivery ticks only work once the webhook is set up. Until then messages stay "Sent".
- Telugu wording, a reply button and a WhatsApp login code are not included (they need the client's decision).
- Hosting: the webhook needs a public HTTPS address, which the current Vercel site has; it moves with the site when hosting details arrive (Phase 10).


## Phase 7 addition — suppliers named by the portal

While looking for supplier data we found that the portal has a read-only endpoint, `GetVendorDtls?requestId=...`, that names the supplier on each delivery note (plus hostel and godown). The hourly check now reads it once per order (up to 120 per godown login per hour) and keeps **only the supplier's id, name and supply category**. The same portal answer also contains the supplier's bank, PAN, phone and e-mail; these are not read out of the response or stored. Supplier performance now uses the portal's supplier for each order, falling back to the district mapping only for orders without one. This reduces how much the client's mapping sheet is needed for the supplier view (it is still needed for district-to-godown history). One real read-only call was made to confirm the endpoint; nothing was written to the portal.

## Phase 10 (partly) and Phase 11

- **Done without hosting details:** `/api/health` (200 while the last good hourly check is under 2 hours old, else 503; shows only times and counts), a red bar on the first page when the check has not worked for over 2 hours, an administrator notice when a godown login is failing, `scripts/backup.sh`, and `docs/handover.md`.
- **Not done (needs the hosting details):** moving the web app, hourly job and database to the client's server, HTTPS, the managed hourly service, off-machine backups, the cut-over.
- **Phase 11:** `docs/acceptance-checklist.md`, `docs/training-guide.md`, and re-runnable local scripts in `scripts/acceptance/`: `check-access.mts` (about 90 role, district and rule checks against a running copy of the app on a made-up database, all passing) and `load-check.mts` (25,000 orders: the main calculations each finish in under half a second locally). The load check does not measure the portal's own response time, which sets how long the hourly read takes.
- The first time WhatsApp is switched to Live, every hostel with a late order and a phone number is due at once (about one message per such hostel). Use Preview for a few days first and consider starting with a test phone only.


## WhatsApp: "Connect WhatsApp" copied from the TeleCRM

The setup flow of the team's TeleCRM (`vivtej_telecrm` page `WhatsAppConnect.jsx`, backend `whatsappOnboardingController.js`) is now in this system, with this site's own look.

- **Sidebar** has a "WhatsApp Cloud API" section (administrators only): "Connect WhatsApp" until a number is connected, then "Reminders" and "Connection".
- **Connect WhatsApp** (`/whatsapp/connect`) is the same five steps: Welcome, Requirements, Connect, Verify, Done. Connect offers **one-click signup with Facebook** (Meta Embedded Signup) or **an existing permanent access token + phone number ID**. Both find the WhatsApp business account from the token, check the number, subscribe the app to delivery ticks and replies, and register the number for the Cloud API. Verify shows the discovered IDs, the webhook address and verify token (with copy buttons) and live checks (token valid, ticks and replies switched on with an "auto-fix" button, reminder wording approved). Disconnect forgets the token.
- **Your Meta app:** both ways go through a Meta app, so the page first asks for its **App ID** and **App secret** (and the **Embedded Signup configuration ID** for one-click signup). The CRM hard-codes the VivTej Meta app and keeps the secret in its server settings; here they are entered on the page and stored sealed. **Decision for the client:** use the client's own Meta app, or VivTej's as a technology provider. Using VivTej's would register the client's number under VivTej's app.
- Tests: 12 core tests with a fake Meta (token path, code path, invalid token, no WhatsApp access, wrong number, refused subscription, checks, fix, disconnect, secrets never stored in the clear or in the change log) and 8 action tests (admin only, plain messages, size limits). **Not tested against real Meta:** the one-click Facebook popup and the live calls. Try the access-token path first with the client's details.
- The Reminders page lost its connection fields (they live in the wizard now).


## WhatsApp CRM (People, Send Message, Chats, Campaigns, Settings, Stats)

**Status:** built locally on branch `whatsapp-suite`, **not deployed**, nothing tested against the real WhatsApp service. See `docs/whatsapp-crm-plan.md` for the page list, limits and what was and was not tested. All pages are administrator-only. Sending stays in preview until an administrator switches WhatsApp to live.


## Precision fixes, readable cards, dark mode and hosted check (branch `precision-fixes`)

**Status:** built locally, **not deployed**. See `docs/hosting.md` for the scheduler setup (two GitHub secrets and one Vercel setting are still needed from the owner).
- Detector: never flags a quantity close to what the hostel asked in any other month; ignores differences under 1 kg or litre (3 for other units); does not trust a student count under 30; drops Minor flags that rest on similar hostels alone; re-checks older open flags.
- Student counts: the largest total over the last 7 days of the attendance report is used (a day with only some classes marked no longer gives a tiny number).
- Cards and pages: readable item names, Hostel ID, request IDs and the hostel phone; chart rebuilt with readable text; Excel button aligned; dark mode with a toggle (device default); tokenised search in any format; supplier cards open exactly the orders they counted; per-order problem labels use the order's own month; fully served / short / waiting tiles; supplied quantities judged only from dispatch; districts saved automatically.
- Hourly check can run from the website (`/api/cron/cycle`) or the worker (`serve`), with a database lock.
- Not verified against production data (read access was not available): the student-count fix and the supplied-quantity change should be confirmed with the two read-only commands in `docs/hosting.md`.
