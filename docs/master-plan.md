# Master plan — client meeting requirements

Source: the translated meeting transcript (client, our developer, and a colleague) plus the client's handwritten checklist.
Every point below is traced back to one of those two. The register below is the planning baseline; current local implementation progress and validation are recorded in [implementation-status.md](implementation-status.md).

**Local implementation update (10 Nov 2026):** the owner authorized phase-wise local development. Release 0 (Phase 3 theme, density, and global search) is implemented locally and passes automated tests/build. Browser/print acceptance and client sign-off remain pending. This is not deployment authorization; Phase 0's external tasks are not marked complete.

---------------------------------------------------------------------
## 0. How to read this document

- **R-numbers** (R1, R2 …) are the individual requirements pulled out of the transcript and checklist. Section 1 lists them all; the phases in section 4 say which R-numbers each phase delivers, and section 8 proves nothing was dropped.
- **Done** = already live. **Partly** = a base exists. **New** = nothing yet.
- Effort figures are working days for one developer, rounded, to feed the costing the client asked for. They are estimates, not quotes.
- Items marked **ASK** are the two optional WhatsApp-login points; everything else was decided in section 3.

---------------------------------------------------------------------
## 1. Requirements register (everything the client said or wrote)

### A. Data and structure
| # | Requirement | Where it came from | State |
|---|---|---|---|
| R1 | Map **33 districts → 18 godowns → 8 suppliers**. A godown can serve several districts, a supplier several godowns. The map **changes over time** (districts get re-assigned to a different godown), so it must be editable, with history. Client will supply the data. | Checklist "Core mapping"; transcript | New |
| R2 | Units on every quantity (kg, packets, 200 g vs 250 g packs). Client: "pick it once from the indent, mapping is there for all, put it under master". | Transcript (units discussion) | New (data exists, see 2.3) |
| R3 | Adding a godown login should load that godown automatically ("add all credentials and everything is added"). | Transcript | **Partly** (Godowns page has an add form; needs admin-only and mapping hook) |
| R4 | Keep **one year** of data carefully, then hand it all over / offload. The one-year hand-over copy is made as **downloadable Excel/CSV exports** of all orders, flags and remarks (no Google Drive, see D8). | Transcript | New |

### B. Access
| # | Requirement | Source | State |
|---|---|---|---|
| R5 | **Individual logins** per operator (name, phone, email), created by an admin. | Transcript, checklist "Login access" | New (today: one shared password) |
| R6 | **District-wise access.** An operator sees only their districts (e.g. 3 or 5 of 33) automatically, with no daily filtering. Admin sees all. Same screens, just filtered. | Both | New |
| R7 | Role-based: admin, operator (telecaller), possibly read-only. | Transcript ("role-based access") | New |
| R8 | Possible **WhatsApp code login** (OTP) instead of email. Client said "we are already doing WhatsApp for you", so treat as optional. | Transcript | New, **ASK** |

### C. Dashboard and search
| # | Requirement | Source | State |
|---|---|---|---|
| R9 | **Stage-wise** view: how many orders in Pending / DC / In-Transit etc. (a "number game"). | Both | **Partly** (Order tracking tabs and counts) |
| R10 | **District-wise** view: per district, how many orders in each stage, how many hostels. | Transcript | New |
| R11 | **Hostel-point-of-view and supplier-point-of-view** dashboards (toggle). Supplier view: is each supplier meeting demand, who under- or over-performs, by district. | Both | New |
| R12 | **Search bar at the top of every page**: hostel full name, partial name, or hostel code. | Both | **Partly** (search only on two pages) |
| R13 | Everything viewable **godown-wise, district-wise, overall**, and exportable to **Excel**. | Transcript | **Partly** (Excel exists for unusual requests and orders) |

### D. Look and feel
| # | Requirement | Source | State |
|---|---|---|---|
| R14 | Smaller fonts, compact tiles/cards, shorter page length: "at a glance I should see more data". | Both | New |
| R15 | **Black-and-white theme.** Colour only for alerts and status tags (red/yellow/green). | Both | New |
| R16 | Tile on the surface = hostel name, hostel code, **type of issue** (duplicate / anomaly / …). Details open on click. | Transcript | **Partly** |
| R17 | The "similar hostels" bar should stay. In the B&W theme it is shown in grey with an outline (see Phase 3), not colour. | Transcript | **Decided (D5)** |
| R18 | Show the **student count** per hostel (about 40 hostels have none). | Transcript | **Done** (labelled estimate for the 40) |

### E. Anomaly workflow
| # | Requirement | Source | State |
|---|---|---|---|
| R19 | **Replace "this is fine / this looks wrong"** with two plain actions. "Wrong" means *issue: the hostel must fix it*. No system "learning": "it might learn wrongly… intimation is enough". | Transcript | **Partly** (buttons exist, wording and meaning change) |
| R20 | **Issue = the whole indent must be redone.** There is **no edit option** (editing wastes time). The hostel raises a fresh indent. One wrong item sends back the whole indent. **The operator rejects it on the real portal; our app only records and tracks it (D3).** | Transcript | New |
| R21 | After an issue/reject, the order sits in a **"waiting for new indent"** list. If the hostel raises a new one, the system **recognises it** and links the two. If none arrives, **alert after 2 days**. | Transcript | New |
| R22 | A **manual flag**: even when the system did not flag something, an operator can raise an issue on any order. | Transcript | New |
| R23 | **Remarks** on each issue/order: who called, when, what was said ("called hostel in-charge on this date, told them to fix chicken masala"). Remarks per stage too. | Both | New |
| R24 | **Duplicate-request alerts.** | Transcript | **Done** (shown as a card type) |
| R25 | **Indent view inside the dashboard** (full item list, units and quantities) so operators do not jump to the portal. | Both | **Partly** (order page lists items, no units) |
| R26 | Hourly pull stays automatic (captcha already bypassed). | Transcript | **Done** (runs on this computer, see R41) |

### F. Order stages
| # | Requirement | Source | State |
|---|---|---|---|
| R27 | Count **days in stage** for **Pending, DC, In-Transit and Variation (D4)**. Once **Acknowledged**, stop counting and show the acknowledged **date in green**. | Transcript | **Partly** (we count every stage; rule changes) |
| R28 | **Rejected / Cancelled are final actions**, not "waiting" stages. | Transcript | **Partly** |
| R29 | Hostel **name + code + issue type** list for stuck orders, per stage. | Transcript | **Partly** |

### G. WhatsApp
| # | Requirement | Source | State |
|---|---|---|---|
| R30 | Automatic **WhatsApp message to the hostel** when an order is **In-Transit and not acknowledged**: one template, wording changes at the bottom. Reminders (3rd, 4th …) as time passes. | Transcript | New |
| R31 | Show **message history on the order** (sent, ticks, reminder 1/2/3/4), and replies if any. | Transcript | New |
| R32 | WhatsApp needs a **fresh number that never had a WhatsApp account** (Meta cloud rules), a business name, a mail ID, and template approvals. | Transcript | New (**long lead**, start now) |
| R33 | Optional: WhatsApp utility template for **login OTP** (R8). | Transcript | New, **ASK** |

### H. Hostel view
| # | Requirement | Source | State |
|---|---|---|---|
| R34 | Click a hostel → **one screen** with: assigned godown, mapped supplier, godown in-charge number, hostel in-charge number, current pending issues, **month-wise indent history** (pick a month: did it come, did it rise). | Both | **Partly** (hostel page has history, no contacts or mapping) |
| R35 | Telecallers get the **contacts handy** on that screen. | Transcript | New |

### I. Documents and hosting
| # | Requirement | Source | State |
|---|---|---|---|
| R36 | ~~Document vault in Google Drive.~~ **Removed (D8).** It was only an idea from the meeting. | Transcript | **Removed** |
| R37 | Host on the client's **GoDaddy server (8 GB RAM)**. We deploy, then **hand everything over**; their in-house person takes over hosting and data. The client will send the hosting details (D2). | Transcript | New (today: Vercel + MongoDB + cron on this PC) |
| R38 | The client has an **existing portal** (ERP, work desk, document manager). **Decision D1: we build on top of this repo only**, standalone, and may be linked from his quick links. | Transcript | **Closed (D1)** |

### J. Commercial and process
| # | Requirement | Source | State |
|---|---|---|---|
| R39 | A **costing estimate** before work proceeds. | Transcript | Section 7 |
| R40 | Timeline: client hoped for "tomorrow". We said basic version in a day, full thing about **10 days**, WhatsApp approval 2–3 days plus about a day per template. | Transcript | Section 5 |
| R41 | The portal "department dashboard" is **not needed**: godown logins already show rejected / approved / in-transit. Just log into every godown. | Transcript | **Done** (verified: the orders endpoint returns every stage) |

---------------------------------------------------------------------
## 2. What we already have, and what we learned from the portal

### 2.1 Built and live
Anomaly detection (own history, similar-size hostels, typing slips, whole-order, duplicates), review buttons, hostel page, accuracy checks, Order tracking (stage columns, days, tabs, Excel), godown add form, hourly sync, sealed credentials, password gate, Vercel hosting.

### 2.2 Gaps against the transcript
- One shared password, no users or districts (R5–R7).
- No master data: no districts/godowns/suppliers map (R1), no item/unit master (R2), no contacts (R34).
- Look and feel is large and coloured (R14, R15).
- "Fine / wrong" buttons mean the wrong thing (R19, R20).
- Days are counted in every stage (R27).
- No WhatsApp, no vault, no hosting on the client's server.

### 2.3 Portal data we verified (no student-level data is involved)
- `GetIndentHostelToVendorRequests` (all stages in one call) gives stage, dates, DC number, vehicle, hostel name, address, district, **hostel mobile**.
- `GetIndentHostelToVendorRequestItems` gives, per item: `item_name`, `uom`, `pack_size`, `brand`, `item_category`, `requested_quantity`, `supplied_quantity`, `received_quantity`, `variation_quantity`, `final_quantity`, `supplier_status`, remarks. **This is where the units come from** (R2, R25) and where **fulfilment** comes from (R11).
- `GetRptGodownDetailed` already carries `godown_contact_person` and `godown_contact_no` (R34).
- The portal keeps **no cancel/reject date**, so we only know when we first saw it.
- **Design rule kept throughout:** the system uses hostel-level and order-level data only. It never requests, stores or shows student names or personal details.

---------------------------------------------------------------------
## 3. Decisions made, and what is still needed

### 3.1 Decisions (confirmed by the project owner, 10 Nov 2026)
| # | Question | Decision | Effect on the plan |
|---|---|---|---|
| D1 | Existing client portal (R38): separate or inside it? | **Build on top of this repository only.** Standalone app. We do not touch or merge into the client's other portal. A link from his portal's quick links is enough. | R38 is closed. No integration work. |
| D2 | Hosting (R37) | **The client will send the hosting details.** | Phase 10 waits on those details. Until then we keep Vercel and Atlas as they are. |
| D3 | "Reject" (R20) | **We never write anything to the government portal.** We have no permission to change it, and we are building only on top of it. Everything we do with the portal is **read-only**. "Issue" is a state **inside our app**. The operator rejects on the real portal themselves. Each hour we read the portal, see that the order became Rejected/Cancelled, and then track the wait for a new indent. | Hard rule for the whole project, see 3.3. |
| D4 | Count days in Variation too? | **Yes, count it.** | Day counting covers Pending, DC Generated, In-Transit **and Variation**. Acknowledge stops the count. |
| D5 | Black and white: which taste? | **We choose the design and build the whole theme.** The client wants black and white only. | Full theme spec in Phase 3. |
| D6 | The 2-day wait after a reject: fixed, or changeable? | Decided for you (see 3.2). | Setting, default 2 days. |
| D7 | Which Meta account sends WhatsApp? | **The client's own business account**, with a fresh number that has never been on WhatsApp. | Phase 8 waits on the client's Meta details. |
| D8 | Google Drive document vault? | **Removed.** | Phase 9 is cancelled. No Drive access is needed. The one-year hand-over copy uses Excel/CSV exports instead. |
| D9 | Reminder rules | **Approved:** first message after 3 days In-Transit without acknowledgement, then every 2 days, up to 4 messages, one per hostel per day, stop once acknowledged. | Built as admin settings, so the numbers can change without code. |
| D10 | Build order | **Requirements first.** No building, not even Release 0, until the client has confirmed the requirement list. | Phase 0 sign-off comes before everything. |

### 3.2 About D6 in plain words
When an operator rejects an indent because of a mistake, the hostel has to send a **new** indent. The client said: "if the new one has not come in two days, show an alert."
- The only thing to settle was whether "2" is hard-wired or a number an admin can change later, and whether it counts calendar days.
- **Default we build:** an admin setting, **2 calendar days**, applies to every godown. If the client later wants a different number, it is one field, no code change. Nothing to decide now.

### 3.3 Hard rules from the project owner
1. **Read-only toward the government portal.** No POST, PUT, DELETE, reject, edit, or any action. Only the existing login and the GET reports we already use.
2. **Everything is built in this repository**, on top of the code that exists.
3. **No student-level data** is requested, stored or shown. Hostel-level and order-level data only.
4. Production deploys only when the owner says so.

### 3.4 Inputs: status after the owner's answers (10 Nov 2026)
The order now is **requirements first, hosting later**. Nothing below blocks Release 0.

| # | Input | Status | What we did / will do |
|---|---|---|---|
| 1 | Hosting details | **Later** | Phase 10 is parked. We stay on Vercel and Atlas until the client sends them. |
| 2 | District → godown → supplier mapping sheet | **Template written**, data comes later | `docs/templates/client-data-template.xlsx`, sheet "1 Mapping". The import in Phase 1 reads exactly these columns. |
| 3 | Operator list | **Template written**, data comes later | Same file, sheet "2 Operators" (see 3.5 for what this means). |
| 4 | WhatsApp sending code | **Reuse from the TELECRM CRM** | Copy the needed parts from `crm_server`; list in Phase 8. |
| 5 | Google Drive | **Removed (D8)** | Nothing to collect. |
| 6 | In-transit reminder wording | **Simple template written** | `docs/templates/whatsapp-reminder-template.md`. |
| 7 | Hostel and godown in-charge numbers | **Later** | Sheet "3 Contacts". We also read what the portal already gives (hostel mobile, godown contact). |

### 3.5 What "operator list" means
These are the **staff who will log in to our dashboard**: the telecallers and district people. In the meeting the client said "Vikas has four districts, I will create Vikas, give phone number, give email, select his districts, hit add, and it only shows him those." To create those logins we need, for each person: **name, phone, email, which districts they look after, and whether they are an admin, an operator or view-only.** It has nothing to do with the portal's own users.

### 3.6 Google Drive: closed
Drive came only from the client's "document vault" idea in the meeting (tender and party documents stored in his 2 TB Drive). The owner removed it (D8). Nothing in the anomaly checks, order tracking or WhatsApp needs it.

Assumption we will build unless told otherwise: if the same item comes in different pack sizes (200 g vs 250 g), we compare like with like (same item and pack size).

---------------------------------------------------------------------
## 4. Phased plan

Order is chosen so the client sees value early, shared groundwork is done once, and the slow external items (WhatsApp approval, server access) start on day one in parallel.

### Phase 0 — Kick-off, decisions, and long-lead items (start immediately)
**Goal:** unblock everything that waits on other people.
- **Requirements sign-off first (owner's instruction):** send the client the requirement list (R1 to R41) and the data templates, and record his confirmation or corrections here before building anything beyond Release 0.
- Collect the items in section 3.4 from the client and record them in this file.
- Start the **WhatsApp** application now (R32): fresh number, business details, Meta verification. Approval runs while we build.
- Ask for **server access** when the client is ready to send it (R37).
- **Rotate** the portal, database and dashboard passwords that were pasted in chat earlier. Store new ones only in the server's secret store.
- Agree the **release plan** (section 5) in writing, so "basic version tomorrow" is not read as "everything tomorrow".
- Confirm how the **costing** is presented (section 7).
- **Done when:** answers recorded; WhatsApp application submitted; server access requested when the client is ready; secrets rotated; **requirement list confirmed by the client (D10)**.
- **Effort:** 1 day (mostly waiting, not coding).

### Phase 1 — Master data (the backbone) → R1, R2, R3, R34 data, R41
**Goal:** one source of truth for who belongs to whom, and what each item's unit is.
- **New collections:** `districts`, `godowns` (links to portal login), `suppliers`, `mappings` (district → godown → supplier with **start and end dates**, so re-assigning a district keeps history), `hostelsMaster` (hostel → district → godown, plus contacts), `itemsMaster` (item → unit, pack size, brand, category).
- **Admin screens** (admin only): list/edit mappings, a **"re-assign district"** action that closes the old mapping and opens a new one on a chosen date, an **import from Excel/CSV** for the client's mapping sheet (R1), a change log (who changed what).
- **Item master from the portal (R2):** a background step reads each item's unit and pack size from the items endpoint **once per item** and stores it. Operators can correct it.
- **Contacts (R34/R35):** hostel mobile (from the orders endpoint), godown contact (from the godown report). Stored as business contacts, visible to logged-in operators in their districts only.
- **Unit-aware detection check:** verify the detector's numbers are in the same unit per item (kg vs packets). If an item has mixed pack sizes, compare like with like. Add a unit test with a real mixed case.
- **Tie to godown add form (R3):** adding a godown login also creates its `godowns` row and prompts for its districts.
- **Done when:** the client's mapping sheet imports; any hostel resolves to its godown and supplier; every item shows its unit; re-assigning a district keeps history.
- **Effort:** 3–4 days.

### Phase 2 — Users, roles and district-wise access → R5, R6, R7 (R8 optional)
**Goal:** each person sees only their districts, automatically.
- **New `users`:** name, phone, email, role (admin / operator / viewer), districts[], status. Passwords stored hashed; admin creates users and can reset or disable.
- **Session** carries the user and role; **every data loader filters by their districts at the database query** (orders, anomalies, hostels, requests, reports, CSVs, search). Not just hidden in the page, so a guessed URL cannot show other districts.
- **Admin-only screens:** Godowns, mappings, users.
- **Audit log:** logins, remarks, issue/fine actions, exports (who did what, when).
- **Optional later (R8/R33):** WhatsApp OTP login once Phase 8 exists.
- **Retire** the shared password after users are created (keep one admin break-glass account).
- **Done when:** a test operator with 3 districts sees only those in every page, CSV and search; admin sees all; a direct link to another district returns "not found".
- **Effort:** 3 days.

### Phase 3 — Look and feel + global search → R14, R15, R16, R12
**Goal:** a compact black-and-white working screen.
- **Theme (decision D5: we chose the design).** Direction: *a quiet, printed-ledger look.* Black ink on white paper, hairline rules, no decoration. Information first. The client wants black and white, so the design depends on **contrast, weight and spacing**, not colour.

  **Palette (tokens, defined once in the stylesheet):**
  | Token | Value | Use |
  |---|---|---|
  | `--paper` | `#ffffff` | page and card background |
  | `--surface` | `#f5f5f5` | table header, zebra rows, inputs at rest |
  | `--line` | `#e2e2e2` | hairline dividers (1 px) |
  | `--line-strong` | `#0a0a0a` | focus ring, selected outline |
  | `--ink` | `#0a0a0a` | text, primary buttons, selected tabs, sidebar |
  | `--ink-2` | `#3d3d3d` | secondary text |
  | `--muted` | `#6b6b6b` | labels, hints (passes 4.5:1 contrast on white) |
  | `--alert-high` | `#b3261e` | **alerts only**: Check now, overdue |
  | `--alert-mid` | `#8a5a00` on `#fff4d6` | **alerts only**: Take a look, waiting a while |
  | `--ok` | `#1a6b3a` | **status only**: Acknowledged date, "Working" |

  **Colour rule (the only places colour may appear):** (1) the three category tabs and severity tags, (2) a day count that has gone overdue, (3) the green Acknowledged date, (4) system errors. Never decorative, never a background of a whole card. Colour is never the only signal: every coloured item also carries a word or icon ("Check now", "66 days late"), so it still reads on a black-and-white printout.

  **Components in black and white:**
  - **Sidebar:** solid black (`--ink`), white text, the current page shown as a white bar with black text. Collapsible, as now.
  - **Buttons:** primary = solid black, white text; secondary = white with a black 1.5 px outline; destructive wording but not colour (an "Issue" button is outlined with an icon, not red).
  - **Tabs and filters:** the selected one is inverted (black fill, white text); the rest are white with an outline. Counts sit in a small outlined pill.
  - **Tables:** no outer card shadow, hairline row rules, light grey header, tabular (fixed-width) digits, sticky header.
  - **Tiles for flags (R16):** white, 1 px border, a left edge bar in black. The severity **tag** is the only coloured part.
  - **History chart:** normal months = mid grey bar; the unusual month = **solid black** bar with its number printed above; "similar hostels" = **light grey bar with a black outline and a hatched fill** (so it stays distinct without colour).
  - **Order stage cells:** a plain number and date. Overdue (7+ days amber text, 15+ days red text with the word "late"). Acknowledged shows the date in green. Rejected/Cancelled show "final", no count.
  - **Inputs:** white, 1.5 px grey outline, black outline on focus (no blue glow).
  - **Icons:** single-weight line icons in ink.
  - **Login screen:** white card on a black page, no gradient.
  - **Print / PDF / Excel:** already black and white, and the theme matches them.

  **Type:** one neutral sans (the current Figtree stays, since it is already bundled). Page title 20 px / 600; section titles 15 px / 600; table and tile text 13.5 px; labels 12 px uppercase-spaced only where needed. Numbers use tabular figures.

  **Dark mode:** not part of this release. The theme is built from the tokens above, so a true inverted dark mode is a later one-file change.

  **Pages covered:** login, Unusual requests, Order tracking, Godowns, Past checks, hostel page, order page, report/print, plus every new page from later phases, which must use the tokens (no new colours allowed).
- **Density:** smaller fonts, tighter spacing, compact tile list (hostel name, code, issue type on the surface; details open on click) (R16). Target: about 2–3× more records per screen than today. Adjustable "Compact / Comfortable" toggle.
- **Global search bar** in the page header on every page (R12): hostel name (full or part), hostel code, request ID. Results respect the user's districts (Phase 2). Until Phase 2 lands, it searches everything.
- **Shorter pages:** smaller summary, collapsed explanations, sticky table headers.
- **Done when:** the same 8 hostels that filled a page now take about a third of it; search works from every page; **no colour appears outside the four allowed places**; a printout in plain black and white still shows which items are urgent (words/icons, not colour).
- **Effort:** 3 days.
- **Quick release (the "basic version"):** the theme, density and search can ship **first and alone** (about 1.5 days) as Release 0.

### Phase 4 — Issue workflow: reject, remarks, manual flag, re-submission → R19–R23, R25
**Goal:** replace "fine/wrong + learning" with the real process the client described.
- **Actions** (replace the two buttons): **Issue (reject this indent)** and **Fine**. Plain words, no "learning" claims, and the screen says what each does.
- **States:** `open → issue raised (waiting for new indent) → new indent received → closed`, plus `fine`. Issue raised records who, when, remarks.
- **Waiting-for-new-indent list** (R21): when a new order arrives from the same hostel for the same month, the system **links** it to the issued one and closes the wait. If none arrives, an **alert after 2 days** (the number is a setting). The alert appears on the dashboard first; WhatsApp to the operator is optional later.
- **Manual flag (R22):** any order can be flagged by an operator with a reason.
- **Remarks (R23):** a remarks thread on every order and every flag: author, date-time, text, optional call outcome. Shown on the order page, hostel page and the waiting list. Also usable per stage.
- **Indent view with units (R25):** the order and flag pages show the **full item list with units and pack size** (from Phase 1's item master), highlighting the flagged items, so the operator never needs the portal.
- **Rule kept:** no edit of indents (client: waste of time). The system never alters an indent.
- **Decision D3:** pressing Issue **never touches the government portal**. It only records the issue in our app. The operator rejects on the real portal. When our hourly read sees the order become Rejected/Cancelled, we mark the issue "rejected on portal" and start the wait for the new indent. If the hostel raises a new order for the same month, we link it.
- **Done when:** an operator can raise an issue with remarks, the order moves to the waiting list, a new matching indent closes it, and a missing one alerts after 2 days.
- **Effort:** 4 days.

### Phase 5 — Stage rules and dashboards → R9, R10, R13, R27, R28, R29
**Goal:** the "number game" views, with the client's counting rules.
- **Counting rules (R27):** days are counted only for **Pending, DC Generated, In-Transit**. **Acknowledge** stops the clock and shows the date in **green**. **Rejected / Cancelled** are final actions with a date or "first seen", no day count. **Variation is counted too (D4).**
- **Stage-wise dashboard (R9):** per stage, serial number, district, count; click through to the list.
- **District-wise dashboard (R10):** per district, orders by stage, number of hostels/societies, stuck counts (over 7 and 14 days).
- **Overall / godown-wise / district-wise** switch (R13), with **Excel export** on each view. A full export of all orders, flags and remarks is the one-year hand-over copy (R4).
- Reuse what is built: Order tracking tabs, stage columns, counts, CSV.
- **Done when:** counts on every dashboard equal the portal's own totals for the same filters; Acknowledged orders show a green date and no running days.
- **Effort:** 2–3 days.

### Phase 6 — Hostel drill-down → R34, R35
**Goal:** one screen with everything about a hostel.
- Header: name, code, district, **godown and supplier** (from mappings), **godown in-charge and hostel in-charge numbers** (tap to call), student count.
- **Current pending issues** (open flags, waiting-for-new-indent, stuck orders) with remarks.
- **Month picker with indent history**: did an indent come that month, how big compared with before, items with units, order stage timeline.
- Links to each order and to its WhatsApp history (once Phase 8 exists).
- **Done when:** from a hostel name or code search, an operator reaches the profile in two clicks and can place a call without leaving the page.
- **Effort:** 2 days.

### Phase 7 — Supplier performance → R11
**Goal:** are the 8 suppliers meeting the demand in their regions?
- **Data:** per order, read the items endpoint (supplied vs requested vs received vs variation) for orders that are not yet final. Incremental and rate-limited (about 300 calls on the first run, then only changed orders).
- **Measures per supplier, godown and district:**
  - Fulfilment: supplied ÷ requested, received ÷ supplied.
  - Speed: days placed → DC, DC → dispatched, dispatched → acknowledged.
  - Open backlog: orders stuck in Pending / DC / In-Transit by age.
  - Rejection and variation rates.
- **Over/under-performance** shown against the average of all suppliers, by district.
- **Toggle** between Hostel view and Supplier view (R11).
- **Checkpoint:** a "meeting demand?" flag per supplier per month, with the numbers behind it.
- **Done when:** the page answers "out of the hostels given to this supplier, how many were served, how many were not, which districts were weakest" and the numbers reconcile with the orders list.
- **Effort:** 3–4 days.

### Phase 8 — WhatsApp → R30, R31, R32 (R8/R33 optional)
**Goal:** automatic reminders to hostels for orders in transit but not acknowledged.
- **Needs from Phase 0:** approved number, verified business, approved templates. Each template approval takes a day or more; the whole approval 2–3 days.
- **Template:** "Your stock was delivered/dispatched against ID … and has not been acknowledged. Please log in and acknowledge." One draft, the tail wording changes by reminder number.
- **Rules:** send when an order has been In-Transit for N days (setting) and is not acknowledged; repeat as reminder 2, 3, 4 at set gaps; **stop as soon as the order is acknowledged**.
- **History on the order (R31):** sent, delivered, read ticks, reminder number, replies. Replies need the inbound webhook.
- **Safety:** one message per hostel per day cap; dry-run mode that shows who would be messaged without sending; opt-out respected; every send is in the audit log.
- **Reuse from the TELECRM CRM (owner's instruction: copy it, do not rebuild).** Source: `Vivtej APPS/TELECRM/crm_server`. That server is a large multi-company chat product (about 5,000 lines for WhatsApp alone, with flows, campaigns, groups, commerce and live chat). We need only a **small slice**, adapted to this repo's style (TypeScript, MongoDB driver, one company):

  | Take from the CRM | Source file | What it does for us | Adaptation |
  |---|---|---|---|
  | Send a template message | `services/whatsappService.js` (`sendMessage`, template path, `POST graph.facebook.com/v24.0/{phoneNumberId}/messages`, 30 s timeout) | Sends the reminder | One account from settings instead of the CRM's per-company lookup (`getCredentials`). Access token stored sealed, like our portal passwords. |
  | Create / submit a template to Meta | `createTemplate`, `sanitizeComponentsForMeta` | Submit `order_not_acknowledged` for approval | Keep as is, minus media upload. |
  | Template approval status | `syncTemplates` | Show Approved / Rejected on a settings page | Simplify. |
  | Webhook: verify and receive | `routes/whatsappRoutes.js` + `controllers/webhookController.js` (GET `hub.verify_token` / `hub.challenge`; POST checks the `x-hub-signature-256` header against the raw body) | Receives delivery ticks and replies | Copy the signature check exactly. |
  | Delivery status updates | `services/whatsappMessageStore.js` `updateMessageStatus` (sent / delivered / read / failed; ignores repeats Meta redelivers) | The ticks shown on the order | Keep the repeat guard. Drop live-chat sockets and campaign stats. |
  | Plain-English error explanations | `utils/metaErrorCopy.js` (141 lines, self-contained) | Explains failures to non-technical staff (e.g. 131026 "could not deliver to this number") | **Copy the file as is.** |
  | Message record shape | `models/WhatsAppMessage.js` | What we store per message (id, direction, status, error) | Reduce to our `whatsappMessages` collection. |

  **Not copied:** flows, campaigns, groups, commerce, automations, analytics, templates library, live chat and socket events, Google-storage media, multi-company logic.
  **Never copied:** the CRM's `.env`, `key.json`, `deploy_key.json`, `sheets_key.json` or any stored tokens. Our WhatsApp keys come from the client's own Meta app and live only in this project's settings.
  **Decided (D7):** the messages go out from the **client's own business account** and a fresh number. We wait for his Meta details; until then everything is built and tested in dry-run mode.
- **Optional:** WhatsApp OTP login (R8/R33) as a second utility template, after the client confirms.
- **Possible reuse:** the team already has a WhatsApp CRM project, so check whether its sending layer can be reused rather than rebuilt.
- **Done when:** in a test with a team phone, an in-transit order triggers the message, the ticks show on the order, the reminder fires on schedule, and it stops after acknowledgement.
- **Effort:** 4–5 days of work, plus 2–3 days of approval waiting that overlaps other phases.

### Phase 9 — ~~Document vault (Google Drive)~~ **REMOVED (decision D8)**
Cancelled by the owner on 10 Nov 2026. The phase number is kept so the other phase numbers do not change. The one-year hand-over copy (R4) is covered by Excel/CSV exports in Phase 5 and Phase 10.

### Phase 10 — Hosting, reliability and hand-over → R37, R26, R4 **(PARKED: starts when the client sends the hosting details)**
**Goal:** run on the client's GoDaddy server and hand it over cleanly.
- **Move** the web app, the hourly worker and the database to the client's server (hosting details come from the client, D2); the hourly job becomes a managed background service, not this PC's cron.
- **Packaging:** containers or a process manager with auto-restart; reverse proxy with HTTPS; secrets in the server's environment, not in files.
- **Reliability:** health check for the hourly job (alert if no successful run for 2 hours), failed-login alerts per godown, nightly database backup (where it is stored is decided with the hosting details).
- **Hand-over pack for their in-house person:** install/upgrade steps, environment variables list, how to add a godown, how to restore a backup, a one-page "what to check each morning".
- **Cut-over plan:** run both for a few days, compare counts, then switch the address; Vercel kept as fallback until sign-off.
- **Done when:** the in-house person can redeploy and restore from the written steps alone, and the hourly job has run unattended for 3 days.
- **Effort:** 3 days (more if the server is hard to access).

### Phase 11 — Testing, training, go-live → all
- **Acceptance test script** per phase using real data (the section 8 checklist).
- **Role tests:** operator with limited districts cannot see others through pages, search, CSV or direct links.
- **Load check:** all 18 godowns, about 2,000+ orders a month, hourly sync finishes well inside an hour.
- **Training:** a one-page guide and a short walkthrough for telecallers and admins.
- **Hyper-care:** daily check for the first week, fix list.
- **Effort:** 2–3 days.

---------------------------------------------------------------------
## 5. Releases and timeline (honest version)

The client heard "10 days". Adding up the phases, that covers the basic version plus roughly two thirds of the core only. Proposed releases:

| Release | Contains | Needs from others | Working days | Note |
|---|---|---|---|---|
| **R0: "basic version"** | Phase 0 + Phase 3 theme, density, search | Nothing | **1–2** | The "tomorrow" version. Looks right, but has no roles or WhatsApp. |
| **R1: core** | Phases 1, 2, 4, 5, 6 | Mapping sheet, operator list | **about 15** | Master data, logins, workflow, dashboards, hostel view. The team's "10 days" was for this, without the testing buffer. |
| **R2: extras** | Phases 7, 8, 10 | WhatsApp approval, server access | **about 11** | WhatsApp goes live only after Meta approval (2–3 days) plus about a day per template. That wait runs alongside R1. |
| **Close** | Phase 11 | UAT time | **2–3** | |

**Total about 29–36 working days of work** for one developer (matches the phase table in section 7). Calendar time is about 5–7 weeks and depends on how fast the client sends the section 3 inputs. If the client needs a firm shorter date, the honest options are: ship R0 + R1 first and treat R2 as a second delivery, or add a second developer.

```
Week 1   P0 + R0 (theme, search) | P1 master data starts
Week 2   P1 finish | P2 roles/districts | P4 workflow
Week 3   P5 dashboards | P6 hostel view | start P7
Week 4   P7 supplier | P8 WhatsApp (approval done by now)
Week 5   P10 hosting (when details arrive) | P11 test + train
```

**Dependency chain (what blocks what):**
`P0 → P1 → { P2, P6, P7 }`, `P2 → P3 district search`, `P1 → P4 (units in indent view)`, `P4 → P8 (alerts reuse workflow)`, `P0 WhatsApp → P8`, `P0 server → P10`.

---------------------------------------------------------------------
## 6. Data model changes (summary)

| Collection | New or changed | Key fields |
|---|---|---|
| `districts` | New | code, name |
| `godowns` | New | portalLogin, name, status |
| `suppliers` | New | name, contact |
| `mappings` | New | district, godown, supplier, from, to (history) |
| `hostelsMaster` | New | hostelCode, district, godown, hostelContact, godownContact |
| `itemsMaster` | New | itemId, name, unit, packSize, brand, category |
| `users` | New | name, phone, email, role, districts[], passwordHash, status |
| `auditLog` | New | user, action, target, time |
| `remarks` | New | targetType, targetId, author, text, time, outcome |
| `issues` | New (replaces the review buttons' status) | orderId, raisedBy, state, raisedAt, waitingUntil, linkedNewRequestId |
| `whatsappMessages` | New | orderId, template, reminderNo, sentAt, status, replies |
| `orders` | Changed | add item snapshot, supplier, godown, acknowledgedOn, per-stage counting flags |
| `anomalies` | Changed | link to issue state, manual-flag source |

---------------------------------------------------------------------
## 7. Costing inputs (for the estimate the client asked for)

**Build effort (working days, one developer):**

| Phase | Days |
|---|---|
| 0 Kick-off and long-lead items | 1 |
| 1 Master data | 3–4 |
| 2 Users and districts | 3 |
| 3 Look and feel and search (R0 inside this) | 3 |
| 4 Issue workflow, remarks, indent view | 4 |
| 5 Stage rules and dashboards | 2–3 |
| 6 Hostel drill-down | 2 |
| 7 Supplier performance | 3–4 |
| 8 WhatsApp | 4–5 |
| 9 ~~Document vault~~ (removed) | 0 |
| 10 Hosting and hand-over | 3 |
| 11 Testing, training, go-live | 2–3 |
| **Total** | **about 29–36** |

(This agrees with the release table in section 5: R0 about 2 + R1 about 15 + R2 about 11 + close about 3. The quote should be based on this number, and should say that calendar time also depends on the client's inputs.)

**Running costs the client should know about (amounts to be filled from current price lists, not guessed here):**
- WhatsApp Business messages (Meta charges per conversation/template category) and the SIM.
- Server (GoDaddy 8 GB, already owned) and domain/HTTPS.
- Database (if Atlas stays, its plan; if self-hosted, backups).
- Support and changes after hand-over (agree a monthly figure or per-change rate).

**Out of scope unless agreed (prevents surprise cost):** editing indents, learning/AI-driven rules, rejecting on the portal automatically (Q3), student-level data, new reports beyond those listed, rebuilding the client's existing portal.

---------------------------------------------------------------------
## 8. Traceability: every point is covered

| R | Phase | R | Phase | R | Phase |
|---|---|---|---|---|---|
| R1 | 1 | R15 | 3 | R29 | 5 |
| R2 | 1 | R16 | 3 | R30 | 8 |
| R3 | 1 | R17 | 3 (ask) | R31 | 8 |
| R4 | 5, 10 | R18 | Done | R32 | 0, 8 |
| R5 | 2 | R19 | 4 | R33 | 8 (opt.) |
| R6 | 2 | R20 | 4 | R34 | 1, 6 |
| R7 | 2 | R21 | 4 | R35 | 6 |
| R8 | 2/8 (opt.) | R22 | 4 | R36 | Removed |
| R9 | 5 | R23 | 4 | R37 | 10 |
| R10 | 5 | R24 | Done | R38 | 0 (ask), 10 |
| R11 | 7 | R25 | 4 | R39 | 7 |
| R12 | 3 | R26 | 10 | R40 | 5 |
| R13 | 5 | R27 | 5 | R41 | Done |
| R14 | 3 | R28 | 5 | | |

**Checklist items (client's paper) → phase:** Core mapping → 1 · Master dashboard hostel vs supplier → 7 · Login district-wise → 2 · 1 Server hosting → 10 (document vault removed) · 2 Dashboard and search → 3, 5 · 3 UI font/card/B&W → 3 · 4 Indent view → 4 · 5 Remarks and rejections → 4 · 6 Hostel view → 6.

---------------------------------------------------------------------
## 9. Risks and how we handle them

| Risk | Effect | Handling |
|---|---|---|
| Mapping sheet arrives late or in a messy format | Phases 1, 2, 6, 7 stall | Build the import tolerant of column names; ship R0 meanwhile; start with districts we can read from the portal data. |
| WhatsApp approval slower than 2–3 days | Phase 8 slips | Submit in Phase 0; build everything in dry-run; no dependency on it for R1. |
| Fresh-number rule not met (old WhatsApp on the SIM) | Meta rejects number | Verify the SIM before submitting; keep a spare. |
| Portal changes or blocks the login/endpoint | Data stops | Per-godown failure alerts; token refresh already automatic; keep raw-response tests. |
| No cancel/reject date in portal | Timing for those stays "first seen" | Shown clearly in the UI, already done. |
| Access leaks across districts | Wrong person sees data | Filter in the database query, tests that try other districts, audit log. |
| Client server cannot run the stack | Delay | Decide in Phase 0; fall back to keeping Vercel until resolved. |
| Scope creep from the client's wider ERP plan | Cost and time | Keep the out-of-scope list; any addition goes through a change note with days attached. |
| Credentials pasted in chat earlier | Security | Rotate in Phase 0, then secrets only in the server environment. |
| Personal data | Compliance | Only hostel/order-level data and official business contacts; no student-level data, restricted by role, logged. |

---------------------------------------------------------------------
## 10. Immediate next actions (this week)

1. Get section 3 answered on one call (the 12 questions).
2. Submit the WhatsApp application (when the client sends his Meta details) and request server access (when he is ready).
3. Rotate the old passwords.
4. Ship **R0** (theme, density, search) as the "basic version".
5. Start Phase 1 with the item/unit master, since it needs nothing from the client and unlocks the indent view.
6. Send the client the costing (section 7) with the release plan (section 5).
