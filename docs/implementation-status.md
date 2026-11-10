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

## Next phase — Phase 1 master data

**Status:** not started. Next implementation work follows the master plan, not a new scope:

1. Add master collections and history-preserving dated district → godown → supplier assignments, with validation and audit events.
2. Ingest item unit/pack-size/brand/category and business contacts from the existing read-only portal responses. Add mixed-unit/pack-size detector regression tests before changing comparisons.
3. Add validated import matching the client's mapping template, mapping reassignment controls, and the godown-creation hook.
4. Ensure new administrative mutations are protected; the shared gate does not distinguish admin/operator today, so role enforcement must be coordinated with Phase 2 rather than claiming admin-only access prematurely.
5. Validate mapping history, item snapshots, importer error handling, and missing-input behaviour before declaring Phase 1 done.

Later phases remain unimplemented unless separately recorded here. Phase 9 stays removed; Phase 10 stays parked pending hosting details. No WhatsApp implementation may fabricate the required TELECRM source or reuse its secrets.
