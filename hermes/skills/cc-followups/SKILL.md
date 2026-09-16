---
name: cc-followups
description: Send follow-ups for overdue open items per China business time.
version: 1.0.0
author: Ark Commerce
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [command-center, followups]
    category: Tools
---

# cc-followups

## When to Use

A `cc-followups` job is queued by `POST /api/agent/tick` when an open
item (SPEC §3.6) becomes overdue. The tick route runs every 15 minutes
and checks every unresolved open item against the China business-time
rules. This skill documents the procedure the command_center plugin's
job poller executes when it claims a `cc-followups` job.

The tick route **never calls an LLM**. It computes due times, importance,
and send-timing deterministically, then queues a `cc-followups` job with
the payload. The poller processes the job the same way it processes
`contacts` and `organize` jobs — deterministically in code.

## Procedure

A `cc-followups` job payload carries: `factoryProductId`, `openItemId`,
`importance` (High / Medium / Low), and `sendAfter` (epoch ms — the
earliest the follow-up may go out, per the 9:30–18:00 CST window).

1. **they_owe — create a follow-up draft.** When the open item
   direction is `they_owe` (the factory owes us an answer), the poller
   creates a follow-up draft via `POST /api/agent/drafts`:
   - `kind: "followup"` (gives it the send-timing buttons from Goal 7:
     Send now / Tomorrow 9:30 China time / In 3 days).
   - `bubbles`: a short, warm, non-pushy message asking for an update
     on the open item's summary. Never names a ship day (P8). English
     only (P5).
   - `source: "ai"` (the guardrail runs server-side on the draft route).
   - `reason`: `"§3.6 follow-up — overdue open item"`.
   - The draft's `send_after` is set to `sendAfter` from the payload
     when it is in the future (outside the business window); when
     `sendAfter` is now (inside the window), the outbox row is
     eligible immediately.

   Importance rating (set by the tick route, carried in the payload):
   - **High** when the open item blocks a sample (`kind:
     sample_tracking` — the factory committed a sample but sent no
     tracking number).
   - **Medium** when the factory was active in the last 7 days (a
     message linked to that `factory_product_id` exists in the last
     7 days).
   - **Low** otherwise.

2. **we_owe — raise the question card, no factory draft.** When the
   open item direction is `we_owe` (we owe the factory an answer — a
   factory question waiting on Haim), the tick route already raised
   the question card to High importance and queued a Haim notification.
   The poller creates **no factory draft** — only the question card and
   the notification.

3. **Send timing.** Follow-ups go out only between 9:30 and 18:00 China
   time on business days. When `sendAfter` is outside that window, it
   is set to the next 9:30 CST business slot (`nextBusinessSlot` from
   `china-time.ts`). The tick route computes this; the poller passes
   it through as the draft/outbox `send_after`.

4. **Archiving.** After 2 unanswered follow-ups for the same
   factory+product (tracked via `followups_sent` on the open item),
   the tick route archives the `factory_product` row automatically:
   sets `archived_at`, logs it in the activity log with Undo, and
   notifies Haim. Undo restores the row. The poller does not perform
   the archiving — the tick route does it when it detects
   `followups_sent >= 2` and the item is still overdue.

## Pitfalls

- Never send a follow-up outside 9:30–18:00 China time. The
  `sendAfter` timestamp in the payload is the gate; when it is in
  the future, the outbox row is not claimable until then.
- Never pushy about ship timing (P8). The follow-up asks for an
  update; it never says "ship today" or names a deadline.
- No factory draft for `we_owe` items — only a question card raised
  to High and a Haim notification.
- The second unanswered follow-up archives the row. The tick route
  increments `followups_sent` each time it queues a `cc-followups`
  job; on the next tick where the item is still overdue and
  `followups_sent >= 2`, it archives instead of queuing a third job.
- Golden Week (Oct 1–7) and weekends: nothing becomes due during
  them. `addBusinessHours` pushes the deadline past non-business days
  with time-of-day preserved.

## Verification

Unit tests in `tests/unit/followups.test.ts` cover:
- Weekend skip: a Saturday item is not due until Monday.
- Golden Week skip: an item opened Sep 30 is not due until Oct 8.
- Friday 5pm + 24 business hours → due Monday 5pm.
- 2nd unanswered follow-up archives the row (no third job queued).
- we_owe raises to High with no factory draft.
