# WhatsApp reminder: "delivery not acknowledged"

A simple first version. One template, one changing line at the end (the client asked for "one draft, the wording at the bottom changes").
Everything here can be edited before it is submitted to Meta. Submitting and approval happen later, when the WhatsApp number is ready.

## Meta submission fields

| Field | Value |
|---|---|
| Template name | `order_not_acknowledged` |
| Category | **UTILITY** (a message about an order that already exists, not marketing) |
| Language | English (`en`) |
| Header | none |
| Buttons | none (keeps approval quick; we can add one later) |
| Footer | none |

## Body text

```
Hello {{1}}, the delivery for request {{2}} was dispatched on {{3}} and has not been acknowledged on the portal yet. Please log in and acknowledge it. {{4}} Thank you.
```

## The four variables

| # | What goes in | Example (also used as Meta's required sample) |
|---|---|---|
| `{{1}}` | Hostel name | Govt BC Boys Hostel Kalwakurthy |
| `{{2}}` | Request ID | IR202600009266 |
| `{{3}}` | Date the stock was dispatched | 06 Nov 2026 |
| `{{4}}` | The line that changes with each reminder | This is the first reminder. |

### What `{{4}}` says for each reminder

| Reminder | Text sent in `{{4}}` |
|---|---|
| 1 | This is the first reminder. |
| 2 | This is the second reminder. Please acknowledge today. |
| 3 | This is the third reminder. The godown is waiting for your acknowledgement. |
| 4 | This is the final reminder. Please contact the godown if there is a problem. |

Rules from Meta that this wording already follows: a variable cannot be the very first or last word, two variables cannot sit next to each other, and a variable value cannot contain a line break. If Meta rejects the wording, the CRM's error-explanation list (see Phase 8 in the master plan) says why in plain English.

## When it is sent (starting values, all changeable in settings)

- First message: an order is **In-Transit** and still **not acknowledged** after **3 days**.
- Then every **2 days**, up to **4 messages** in total.
- At most **one message per hostel per day**.
- Only between **9:00 and 18:00 India time** (so nobody is messaged at night). Changeable.
- **Stops immediately** when the order becomes Acknowledged, Rejected or Cancelled.
- A **dry-run mode** shows who would be messaged without sending anything.

These numbers are our starting guess, not the client's. Confirm or change them with the client.

## Not included yet

- A Telugu version. Add it only with wording checked by a native speaker.
- A reply button ("Acknowledged / Problem"). Possible later.
- A login-code (OTP) template. Only if the client asks for WhatsApp login.
