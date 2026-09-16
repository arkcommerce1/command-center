---
name: cc-organizer
description: Link chat messages to products and record steps and status.
version: 1.0.0
author: Ark Commerce
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [command-center, organizer]
    category: Tools
---

# cc-organizer

## When to Use

An `organize` job is queued by `POST /api/agent/ingest` whenever a message
arrives in a chat (one pending organize job per chat; contact jobs are
separate). The command_center plugin's job poller claims these jobs and runs
this procedure **deterministically in code — no LLM is ever called** for
organize jobs. This skill documents that exact procedure so runs, reviews,
and fixture tests all agree on what the poller does.

Jobs are **batched per chat**: a chat is processed only when its newest
queued organize job is older than 2 minutes (quiet period), so a burst of
messages is organized once, not once per message.

## Procedure

The rich job payload carries a per-chat snapshot: `chat` (id, name,
factory_id — empty for a brand-new group), `products` (each with
`factory_product_id`, `product_id`, `name`, `last_active_at`), `messages`
(id, text, direction, sender_type, sent_at, oldest first), optionally
`spec` (`fields: [{key, tag}]` with tag `locked`/`flexible`),
`open_change_counts` (`{factory_product_id: n}`), and `open_items`
(`[{id, kind}]`). Minimal payloads (`chat_id` only, which is what ingest
queues today) cannot be processed — they are logged and marked done (see
Pitfalls). Every automatic action is logged in the gateway log.

For each batch, oldest message first:

1. **Link every message to one product** via
   `POST /api/agent/messages/:id/annotate` (`factory_product_id`).
   Single-product group: link directly. Multi-product group: pick the
   product whose name words appear in the text (case-insensitive substring;
   most name-word hits wins, ties broken by most-recently-active product).
   Fully ambiguous: use the most-recently-active product. The Agent API has
   no field for the guessed flag, so a guessed link is recorded in the
   status note (`product_guessed:<fp>`) and the gateway log instead.
2. **Non-English: never guess a translation.** Annotate with
   `translation: ""` and the detected `lang` (`zh` when CJK characters are
   present, else blank). Open a `question`-kind question
   (`body: {issue: "untranslated_text", message_id, lang}`, importance low)
   so Haim sees the gap. Outgoing drafts stay English-only.
3. **Mark steps only on proof patterns** via `POST /api/agent/steps`
   (the server re-rejects acks; the poller pre-filters the same list so a
   thumbs-up, `ok`, or single emoji never even becomes a call):
   - step 1: a real reply about the product — not ack-only, not
     greeting-only, and either mentions the product or is ≥ 12 chars.
   - step 2: confirm-they-can-make-it phrases (`we can make`,
     `yes we can make/do/produce`, `can be made/produced`, `able to
     make/produce`, `可以做/生产`).
   - step 3: spec-confirm phrases (`confirm/agree/approve/accept … spec`,
     `spec … ok/fine/good/correct/match`, `确认/同意 … spec`), only when
     that product has zero open changes (`open_change_counts` == 0).
   - step 4: sample-commit phrases (`will send the sample`, `send/ship/
     arrange … sample`, `寄样/发样品/样品寄出`).
   - step 5: a tracking-number match (see 7).
4. **Status** via `POST /api/agent/status` (`status_sentence`,
   `waiting_on`, `next_step`; the server stamps `waiting_since`).
   `waiting_on` priority, first match wins: `haim` when a question/fee
   card or draft was created in this batch; otherwise `factory`. (`yuki`
   / `carrier` / `none` apply to sample flows owned by later goals.)
   `next_step` names the first undone step for the product.
5. **Quotes**: a price pattern (currency symbol adjacent to a number, or a
   pricing word per §3.4 next to a number) → `POST /api/agent/quotes`
   (`factory_product_id`, `message_id`, full text). Quotes are read-only
   for Haim; the reply draft never contains numbers.
6. **Adjustments**: a change-proposal pattern (`change/adjust/modify/
   revise/instead of/can we make it …`, `改/调整/换成`) → record via
   `POST /api/agent/adjustments` (`field_key` best-effort keyword,
   else `unspecified`; `result: pending`; `message_id`). When the payload
   `spec` tags the field `flexible`, record `accepted`; when `locked`,
   record `declined`. Without spec tags, also open a `we_owe` question
   open-item so Haim decides.
7. **Tracking numbers**: regex (`[A-Z]{2}\d{9}[A-Z]{2}` UPU,
   `SF/YT` + 10+ digits, or any standalone alnum token ≥ 10 chars) →
   mark step 5, `POST /api/agent/shipments` (`leg: china_to_yiwu`,
   `tracking_number`, `status: created`), open a `they_owe`
   `sample_tracking` open-item on a sample commit and resolve it when the
   tracking number arrives (`POST /api/agent/open-items/:id/resolve`).
8. **Fee requests** (sample-fee words, or currency + `fee/sample/pay`
   context) → `POST /api/agent/questions` (`kind: fee`,
   `body: {message_id, text}`, importance high). Never agree to a fee.
9. **New-group setup** (chat has no `factory_id`): the Agent API has no
   factory- or factory_product-create endpoint, so this path is log-only
   today (gateway log + STACK follow-up): log the proposed factory name
   (group name or company in messages) and the opener that would be
   queued. No opener draft is queued without a `factory_product_id`.
10. **Reply decision** per §3.8, via `POST /api/agent/drafts`
    (`kind: reply`, canned short bubbles, `source: ai`; the guardrail
    runs server-side; the Goal 8 drafter owns final wording):
    greeting / `ok` / `please wait` / thumbs-up → nothing, log only;
    spec-answerable question → draft; spec-gap question → question card;
    flexible-field change → acceptance draft; locked-field change →
    polite-decline draft; price quote → quote + number-free thanks draft;
    MOQ/volume/payment question → question card; fee → fee card;
    step 2/3/4/5 confirmations → mark step + matching draft
    (spec questions / spec confirmation / sample request with Yiwu
    address / thanks).

## Pitfalls

- Acks never mark steps: `ok`, `okay`, `noted`, `received`, `thanks`,
  `got it`, `please wait`, `one moment`, `好的/收到/稍等`, emoji-only
  (no letters, numbers, or CJK). The server rejects these too — the
  poller filters first so the log stays clean.
- Never invent a translation. Non-English text keeps `translation: ""`
  plus a low-importance question card.
- Never invent a factory, product, or spec field. Blank/guessed-flagged
  beats a confident wrong link; `field_key: unspecified` beats a wrong key.
- `product_guessed` has no Agent API field: it lives in the status note
  and the gateway log until the API gains one.
- Minimal job payloads (`chat_id` only, no message snapshot) cannot be
  processed — log and mark done so the job does not poison-loop; message
  snapshots must be embedded at queue time.
- Dry-run mode (`dry_run` payload flag or `CC_ORGANIZE_DRYRUN=1`) builds
  the exact request bodies but performs zero API calls.

## Verification

Simulate the handler functions directly in Python on the VPS with
fabricated payloads in dry-run mode — never write test data to
production. Fixtures: single-product link; multi-product keyword link;
ambiguous link uses most-recently-active + guessed flag in note/log;
Chinese text yields empty translation + question card; `ok`/thumbs-up
yields zero step calls; step 2/4/5 patterns yield step calls + shipment
on tracking regex; price text yields a quote and a number-free draft;
fee text yields a fee question; new-group payload yields log-only lines.
Each run must also assert zero HTTP calls in dry-run. Live proof still
needs real traffic: a first real multi-message burst processed once per
chat after the 2-minute quiet period (see docs/STACK.md).
