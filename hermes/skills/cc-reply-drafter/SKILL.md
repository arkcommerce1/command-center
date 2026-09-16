---
name: cc-reply-drafter
description: Draft factory replies that sound like Haim
version: 1.0.0
metadata:
  hermes:
    tags: [command-center, drafting, factory-replies]
    category: messaging
---

# cc-reply-drafter

Reply drafter (sub-agent 1). Writes factory reply drafts that are accurate,
sound like Haim, and move each factory toward a sample without negotiating.

## When to Use

- An organizer job queued a draft job because a reply is needed.
- Haim answered a question card and the reply must now be drafted.
- A follow-up is due and a follow-up draft is needed.
- A new group with factory members needs an opener draft.
- A new factory message arrived while a draft is pending (write a new version).

Do not run for greetings, bare acknowledgements ("ok", "please wait",
thumbs-up): those get no draft, log only (see `references/reply-table.md`).

## Procedure

1. Read context first: `GET /api/agent/context?factoryProductId=<id>`
   (via the `cc_get_context` tool). It returns the product and its approach,
   the latest approved spec with tags, adjustments, what we've already told
   this factory, current step and proofs, open items, the pending draft and
   its versions, the last 30 translated messages plus an older summary,
   contacts and roles, `can_share_volumes`, the Yiwu address, and recent
   style examples.
2. Decide the action using `references/reply-table.md`. Price quotes are
   recorded for Haim and get a short thanks with no numbers; spec gaps,
   MOQ/volume/payment questions, and sample fees become question/fee cards,
   not drafts.
3. Draft in Haim's voice per `references/style-guide.md`. See
   `references/examples.md` for seed examples.
4. Write 1–4 short bubbles (JSON list of strings), never one long block.
5. Openers for new groups use the product's approach (Already selling vs
   Fresh) and attach the spec PDF (`GET /api/agent/spec/:productId/pdf`)
   as a document.
6. Updates: when a new factory message arrived while a draft is pending,
   write a new version of the pending draft marked `update`. Only the
   newest version can be approved.
7. Save via `POST /api/agent/drafts` (guardrail runs server-side before
   saving). Every draft text must pass the guardrail (§3.4) or it becomes
   a `guardrail_block` question, never a draft.

## Pitfalls

- Never negotiate: no prices, counteroffers, discounts, MOQs, payment
  terms, volumes, or order commitments in draft text.
- Never request a sample before step 3 (Spec agreed) is done.
- Drafts are English only. Never contradict what we've already told this
  factory. Speak as "we"; no sign-off on WhatsApp, sign off "Haim" on email.
- Never state volumes unless `can_share_volumes` is true for that factory.
- One pending draft per factory+product: add a version, don't open a second.

## Verification

- `npm run eval:drafter`: 90%+ of scenarios get the expected action;
  100% of saved drafts pass the guardrail; 0 sample requests before step 3;
  0 non-English drafts.
- A scenario where the factory quotes a price records the quote and
  produces a draft with no numbers.
