# HANDOVER — Command Center Dashboard → Claude Code

Date: 2026-09-17 (session handoff)
Handing off from: Hermes Agent (this session)
Handing off to: Claude Code (new sole owner of website code)

Hermes Agent's role from this point: **Donna only** — WhatsApp/email connection,
`command_center` Hermes plugin, and `cc-*` tools/skills. No more website builds,
schema changes, or migrations from Hermes unless explicitly re-authorized.

---

## 1. Half-finished work (Round 5, in progress when handoff happened)

**Goal 1 — DONE and deployed.** Root cause of "no actionables ever created" was
two bugs, both fixed:
- `/api/decisions` (the Actionables page's data source) only read the dashboard's
  Postgres `drafts` table (always empty). The `command_center` plugin actually
  writes drafts into a separate **agent store** (`agent_kv` JSON blob in Postgres,
  accessed via `src/lib/cc/agent-store.ts`). Fixed by rewriting
  `src/app/api/decisions/route.ts` to merge agent-store drafts (joined with
  `draftVersions` for `bubbles` text) with dashboard-store drafts.
- The plugin's job-completion calls (`/api/agent/jobs/:id/done` and `/failed`)
  were sent without `lease_token`, so every job silently returned 400 and stayed
  stuck in `status=running` forever, blocking downstream job chains. Fixed on
  both sides: plugin now sends `lease_token`; the done/failed API route
  (`src/app/api/agent/jobs/[id]/done/route.ts`) was relaxed to not hard-require
  a matching lease when the token is empty/absent (backwards-compat).
- ~16 legacy stuck jobs were manually marked `done` via direct Postgres access
  to unblock the queue. This was a one-time manual cleanup, not a schema change.

**Goal 2 — PARTIALLY verified, NOT complete.** Confirmed the drafter logic
(`_decide_action()` in the plugin, mirrors `src/lib/cc/drafter.ts` intent)
already classifies incoming text into: opener (first contact), spec question
(has "?"), price quote, sample fee (escalates to a question, doesn't auto-draft),
MOQ/payment terms (escalates), tracking number capture, sample-commit ack,
spec-confirm, and locked-vs-flexible change requests. Acks ("ok thanks") and
greetings correctly produce no actionable.

**NOT verified**: fee/quote/quantity-question classifiers against an
**already-linked** factory+product — every simulated test message used a phone
number not yet linked to any product, so each one spawned a brand-new factory
contact + a "pick a product" question instead of exercising the deeper
classifiers on live product context. Also not verified: the "Retry draft" button
behavior on a genuine AI-call failure (no natural failure occurred in this
session to observe it).

**Goals 3-8 — NOT STARTED.** These are the "learning from feedback" goals:
lesson records on Approve/Suggest-changes/Disapprove, turning feedback into
persisted rules (all-factories vs per-factory scoped), using those rules +
past examples in future drafts, a "What Donna learned" Settings page, growing
an eval test set from real corrections, and an end-to-end proof loop. None of
this schema or logic exists yet. Needs: a `lessons` table/store, a `rules`
table/store, and rework of the draft-generation prompt to inject hard rules
(docs/SPEC.md) + learned rules + past examples, in that priority order.

## 2. Actionables marked "VERIFIED" using simulated/fake data (not real WhatsApp)

Per explicit user approval mid-round ("accept API simulated messages instead"),
the following were verified using **direct calls to `/api/agent/ingest`**
(the same endpoint the plugin calls from a real WhatsApp event), NOT real
phone-to-WhatsApp-to-CC-Test-group messages as the round's original rules
required:

- Goal 1B (Round 4, "Our people" phone matching) — verified partly with real
  Settings data (Yuki's and Shene's real numbers) but the "ours vs not-ours"
  behavior was tested via direct ingest calls with fabricated phone numbers,
  not real WhatsApp sends.
- Round 5 Goal 1 (job pipeline trace) — verified via direct Postgres queries
  and direct `/api/agent/ingest` calls, not real messages.
- Round 5 Goal 2 (draft classification) — verified via ~6 direct
  `/api/agent/ingest` calls with fabricated sender names/phone numbers
  ("Carlos from Nanjong", "Wendy from GreenLeaf Manufacturing", fake JIDs like
  `15559998888@s.whatsapp.net`, `8613900001111@s.whatsapp.net`).

**None of Round 5's Goal 2 checks were done with a real phone sending into the
real CC Test WhatsApp group**, despite that being the round's stated bar before
the user relaxed it. Treat all Round 5 verifications as logic-level checks, not
end-to-end proof against the real WhatsApp/CC Test surface.

## 3. Test data created this session (needs cleanup or should be left as-is — your call)

Fabricated factory contacts / messages / drafts created via direct
`/api/agent/ingest` calls during Round 4 and Round 5 testing, all posted into
the **real CC Test WhatsApp group** (`120363411793097593@g.us`) using fake
sender identities:
- `15559998888@s.whatsapp.net` — "Carlos from Nanjong", "Shene from Nanjong"
  (multiple test messages: order quantity, spec sheet, sample fee, "ok thanks")
- `8613900001111@s.whatsapp.net` — "Wendy from GreenLeaf Manufacturing"
- Assorted earlier `wa:goal2-test-*`, `wa:goal2-fresh-*`, `wa:fresh-*`,
  `wa:leasefix-*`, `wa:seq1-*` external_ids
- One `cc-echo` type test job (`testclaimzvvbkq`) inserted directly into the
  agent store's `agentJobs` array via psql, for a claim/lease debugging test.

This created real rows in the live agent store: multiple new "factory" contacts
(auto-created because these fake senders were never linked to a product),
multiple `product_pick` questions, and multiple opener drafts. These are
currently visible on `/dashboard/actionables`, `/dashboard/contacts`, and
`/dashboard/messages` mixed in with real data. **They are not flagged or tagged
as test data in the database** — there's no `is_test` field. If you want them
removed, they'd need to be identified by the fake external_ids above and deleted
from the agent store's `factories`, `messages`, `questions`, `drafts`, and
`draftVersions` arrays (all inside the single `agent_kv.data` JSON blob, id='db').

## 4. Where things live

**Website codebase**: `C:\Users\haim\command-center-v4\` (Windows dev machine)
— sole source of truth, mirrored on the VPS at
`/home/openclaw/command-center-dashboard/` via `git pull`.
GitHub remote: `origin` → `main` branch (check `git remote -v` for exact URL).

**Deployment**: VPS-only (`ark-vps`, IP `2.25.175.196`). Vercel is fully
abandoned — do not re-introduce it. Dashboard runs as systemd service
`cc-dashboard` (Next.js on port 3100, reverse-proxied by Caddy on port 80).
Deploy = `git pull` on VPS + `npm run build` + `systemctl restart cc-dashboard`.

**Database**: local Postgres on the VPS, DB `command_center`, user `openclaw`.
Two logical stores share this one Postgres instance:
- Dashboard store (`src/lib/cc/store.ts` / `pg-adapter.ts`) — proper relational
  tables for products, factories, contacts, etc.
- **Agent store** (`src/lib/cc/agent-store.ts`) — a single JSON blob in table
  `agent_kv`, row `id='db'`, containing arrays: `agentJobs`, `messages`,
  `drafts`, `draftVersions`, `questions`, `factories`, `chats`, `chatMembers`,
  etc. This is what the Hermes plugin reads/writes via the `/api/agent/*`
  routes. **These two stores are logically separate and do not auto-sync** —
  any dashboard page/route reading "the data" needs to explicitly merge both
  if it wants to see plugin-created records (see `/api/decisions` and
  `/api/drafts` as the reference pattern already fixed this session).

**Login/auth**: currently fully disabled. `src/proxy.ts` is a passthrough
(`NextResponse.next()` for all routes) per explicit user request
("remove the google auth for now"). Re-enable with Auth.js when the user
asks — do not silently re-enable it.

## 5. Hermes / Donna plugin — where it lives, what NOT to touch

**Hermes profile**: `donna-factory`, on the VPS, running as systemd user
service `hermes-gateway-donna-factory.service` under Linux user `openclaw`.
Confirmed active and running at handoff time (PID 2751609, up since
2026-09-16 20:52:57 UTC — do not restart, re-pair, or touch this session).

**WhatsApp bridge**: separate Node process
(`/home/openclaw/.hermes/hermes-agent/scripts/whatsapp-bridge/bridge.js`,
port 3001, mode=bot), running as root PID 1916940. Confirmed active. This is
the actual WhatsApp session/pairing — never touch this process or its session
directory (`/home/openclaw/.hermes/profiles/donna-factory/platforms/whatsapp/session`).

**Plugin code**: `/home/openclaw/.hermes/profiles/donna-factory/plugins/command_center/__init__.py`
— a single large Python file implementing: ingest handling, job runner
(polls `/api/agent/jobs/claim` every ~5s), outbox sender, tick loop, the
`_decide_action()` drafter logic, "our people" phone matching
(`_our_people()`), and 14 `cc_*` tools exposed to the agent. This file is
**not version-controlled in the website git repo** — it lives only on the VPS
filesystem. If Claude Code needs to change plugin behavior, changes must be
made directly on the VPS at this path (or copied off, edited, and scp'd back).
No automatic deploy pipeline exists for this file.

**Env/config**:
- `/home/openclaw/.hermes/profiles/donna-factory/.env` — has `CC_AGENT_TOKEN`
  (must match the dashboard's `.env.local` value or every `/api/agent/*` call
  401s — this exact mismatch caused a real production incident earlier, the
  "Rose Shene message lost" bug from Round 4).
- `/home/openclaw/command-center-dashboard/.env.local` — has matching
  `CC_AGENT_TOKEN`, `DATABASE_URL`.

**LLM**: Nous Portal only (`z-ai/glm-5.2` / `z-ai/glm-5.3-flash`). Anthropic key
is explicitly forbidden for Donna's own reasoning — do not add one to her
profile config even for testing.

**Do not touch**: Donna's WhatsApp pairing/session (per user's explicit rule,
repeated every round), Donna's skills (`write_approval: true`, locked —
no self-improve/`/learn` for this work).

## 6. Known live issues at handoff (for whoever owns the website now)

- Actionables page will now show extra "phantom" factory/contact/draft entries
  from this session's simulated test messages (see section 3). Real user
  action needed: either ignore them, or ask Hermes/Claude Code to clean them
  from the agent store.
- `/api/decisions` and `/api/drafts` both independently merge agent-store +
  dashboard-store data with slightly different logic — worth eventually
  unifying into one shared helper so they can't drift again.
- The organize job pipeline debounces 120s per chat before creating
  contacts/actionables (`ORGANIZE_QUIET_S = 120` in the plugin) — this is
  intentional batching, not a bug, but can look like "nothing happened" if
  checked too quickly after a message.
- Round 5 Goals 3-8 (feedback learning) are unbuilt — no lessons/rules schema
  exists yet.
