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
