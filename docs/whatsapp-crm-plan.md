# WhatsApp CRM: phase-wise plan

**Goal:** the WhatsApp part of the team's TeleCRM (`vivtej_telecrm` + `crm_server`) working in this system, in this site's theme: **Connect, Templates, People, Send Message, Chats (inbox), Campaigns, Settings**. Built from the source's structure and rules, rewritten in TypeScript for one business account and this stack (Next.js, MongoDB, no sockets).

**Ground rules (all phases)**
- Nothing is written to the government portal. WhatsApp is the only outside service written to.
- **Preview first.** Real sending needs: WhatsApp connected, mode *Live*, and (for template messages) an *Approved* template. In preview mode every screen shows what would happen and sends nothing.
- Opted-out people are never messaged. One reminder per hostel per day (existing rule) stays. Bulk sends have a daily cap and a pause between batches.
- A message outside WhatsApp's 24-hour window must be an approved template (the source's rule, error 131047).
- Every send, import, delete and setting change is written to the audit log. Phone numbers are shown masked except to the people who need them (chat, people).
- Each phase ends with unit tests (fake Meta), a real-MongoDB check, a browser check, and one commit. No deploy without the owner saying so.

## Source map (what is copied from where)
| Part | Source page | Source backend | Here |
|---|---|---|---|
| Connect | `WhatsAppConnect.jsx` | `whatsappOnboardingController.js` | **Done** |
| Templates | `MessageTemplates.jsx`, `WhatsAppTemplateCreator.jsx` | `whatsappService.js` (create/list/delete/sync) | **Done** (no AI helpers, no media headers) |
| People | `WhatsAppPeople.jsx` | `whatsappContactController.js`, group controller | Phase 1 |
| Send Message | `WhatsAppSend.jsx`, `WhatsAppTemplateSenderModal.jsx` | `whatsappController.js` send paths, `whatsappService.sendMessage` | Phase 2 |
| Chats | `Messages.jsx`, `InboxFilterMenu.jsx` | `whatsappMessageStore.js`, webhook, conversation fields | Phase 3 |
| Campaigns | `WhatsAppCampaigns.jsx` | `whatsappCampaignController.js`, `whatsappCampaignTasks.js` | Phase 4 |
| Settings | `WhatsAppSettings.jsx`, `SettingsTabs.jsx`, `WhatsAppBusinessProfile.jsx` | business profile + quick-reply controllers | Phase 5 |
| Stats | `WhatsAppStats.jsx` | `whatsappAnalyticsService.js` | Phase 6 |
| Not copied unless asked | Flows, Automations, Auto-reply, AI bot, Catalogue | | out of scope |

## Data (new collections)
`waContacts` {phone (unique, 91XXXXXXXXXX), name, tags[], source, notes, optedOut, createdAt, updatedAt, lastMessagedAt}
`waConversations` {phone (unique), contactName, lastText, lastAt, lastDirection, lastInboundAt (24h window), unread, status open/closed}
`waCampaigns` {name, template, language, audience, variableMap, status draft/running/paused/done/cancelled, totals, createdBy, createdAt, startedAt, finishedAt}
`waCampaignRecipients` {campaignId, phone, name, values[], status queued/sent/delivered/read/failed/skipped, messageId, error}
`waQuickReplies` {title, text}
`whatsappMessages` (exists) gains `phone`, `kind` (template/text), `campaignId`, `sentBy`.

## Phases
**Phase 1: People (contacts).** List with search, tag filters, counts; add, edit, delete; tags; notes; opt-out switch; CSV/Excel import (validated, dry-run summary before saving, duplicates merged by phone); export; "Add from hostels" (hostel in-charge numbers from Master data, tagged by district). *Done when:* import of a messy sheet saves only the valid rows and reports the rest; a number can never exist twice; opted-out contacts show it everywhere.

**Phase 2: Send Message.** Pick one or several people (or type a number), pick an approved template, fill each variable (from the contact's fields or typed), see the phone preview per recipient, send. Free text only when the person messaged in the last 24 hours. Preview mode shows "would send" and sends nothing. Result per recipient with plain-English failure reasons. *Done when:* a template send, a text reply inside the window, a refusal outside it, an opted-out skip and a preview-mode dry run all behave as described, and each leaves the right history.

**Phase 3: Chats (inbox).** All conversations (replies, reminders, sends) in one list: search, filters (unread, open/closed, today), last message, unread count; thread with delivery ticks, date separators, message status and failure reasons; reply box (text in window, template picker outside it), quick replies; mark read; close/reopen; refresh every few seconds while open (no websockets on this host). Inbound from unknown numbers creates a person and a conversation. STOP still opts the person out. *Done when:* an inbound webhook appears in the list within a refresh, unread clears when opened, and replies obey the 24-hour rule.

**Phase 4: Campaigns.** Create (name, approved template, audience by tags / hand-picked / all, variable mapping), review (count, skipped opted-out, preview), start, pause, resume, cancel; sending in small batches with a pause between them and a daily cap; per-recipient status with ticks; stats (sent, delivered, read, failed) and retry failed; the hourly job continues a running campaign. Preview mode runs the whole flow without sending. *Done when:* a 200-person campaign finishes in order, a pause stops it within one batch, opt-outs are skipped, and totals add up.

**Phase 5: Settings.** One Settings hub with tabs: Templates, Business profile (about, description, address, email, websites via the Graph API), Quick replies, Reminders, Connection. *Done when:* the business profile reads from and saves to WhatsApp, and quick replies appear in the chat reply box.

**Phase 6: Stats and hardening.** Delivery/read rates by day and by template, failures grouped with their plain-English reason; rate limiting; stale "sending" cleanup; retention of chat history; full test pass; acceptance script and docs. *Done when:* the acceptance script covers every new page and role, and a fake-Meta end-to-end run passes.

**What cannot be proven here:** anything that needs the real Meta service (live sends, templates approval, one-click signup, webhooks from Meta). Every such path is built against Meta's documented API, tested with a fake Meta, and listed in the status document as "not tested live".

## Status (all six phases built on branch `whatsapp-suite`)
| Phase | Page(s) | State |
|---|---|---|
| 1 People | `/whatsapp/people` | Built. Contacts, tags, groups, CSV/XLSX import with preview, export, opt-out, "Add hostels". |
| 2 Send Message | `/whatsapp/send` | Built. Preview first; live only when WhatsApp is set to live; opted-out people never messaged; double-click safe; 50 people per send, 300 per hour. |
| 3 Chats | `/whatsapp/chats` | Built. Replies from anyone create a person and a chat; 24-hour reply rule; unread; close/reopen; refreshes every 8 seconds; quick replies. |
| 4 Campaigns | `/whatsapp/campaigns` | Built. Batches of 20, daily cap 1000, pause/resume/cancel, retry failed, preview runs send nothing, the hourly job continues running campaigns. |
| 5 Settings | `/whatsapp/settings` (tabs: Templates, Business profile, Quick replies, Reminders, Connection) | Built. |
| 6 Stats and hardening | `/whatsapp/stats` | Built. Delivery and read rates by day and template, failure reasons in plain words, stuck "sending" messages closed after 30 minutes, chat history older than a year removed (reminder records kept). |

**Tested:** 530 unit tests; 56 real-MongoDB checks with a stand-in for WhatsApp (`scripts/acceptance/whatsapp-check.mts`); role and access checks for every new page (`scripts/acceptance/check-access.mts`); production build.
**Not tested against the real WhatsApp service** (needs the client's Meta account): live sends, template approval, the Facebook sign-in popup, webhooks from Meta, the business profile read and save. Built from Meta's documented API.
**Not deployed.** Nothing here has been put on the live site.
**Deliberately not copied from TELECRM:** flows, automations, auto-reply, AI bot, catalogue.
