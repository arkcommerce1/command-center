# STACK — Goal 0 audit (verified, not from memory)

Spec: docs/SPEC.md v5 (Sep 15, 2026). Every claim below was verified with real
tool output on Sep 16, 2026. Where a check failed, that is stated, not guessed.

## 1. Framework / hosting / database / auth

- **Framework:** Next.js `^16.3.5`, React `^19.3.0`, react-dom `^19.3.0`
  (source: `package.json` dependencies). TypeScript strict, Tailwind v4, shadcn/ui.
- **Database, no ORM:** `src/lib/cc/store.ts` imports `@vercel/postgres`
  (`^0.10.0` in `package.json`) directly via dynamic `import("@vercel/postgres")`
  and uses the `sql` template tag. No Drizzle/Prisma/any ORM anywhere.
  Dual backend: Postgres when `DATABASE_URL` is set, otherwise file-backed
  `data/store.json` (same API). Tables are `id TEXT PRIMARY KEY, data JSONB`:
  products, factories, contacts, drafts, draft_versions, layer_proofs,
  decisions, factory_product_links, settings (single-row `singleton`).
- **Hosting (Vercel):** project `command-center-review` (team `ark-commerce`).
  Production aliases: `command-center-review-tau.vercel.app` (and
  `command-center-review-ark-commerce.vercel.app`), pointing at deployment
  `command-center-review-p2qvmdtc3-ark-commerce.vercel.app` (Ready, Production).
  (source: `vercel ls` + `vercel alias ls` from repo dir.)
- **Auth: NONE — explicitly, no auth exists.** There is no `middleware.ts`
  (only the inert stub `src/proxy.disabled.ts`), no next-auth/Auth.js/Clerk
  code, no login page. Grep for login/auth/session/middleware across `src/`
  returns only the disabled proxy stub plus false-positive UI component names.
  Only env vars referenced in source: `DATABASE_URL`, `NOUS_API_KEY`.
  No `CC_AGENT_TOKEN`, `CC_ALLOWED_EMAILS`, `AUTH_*`, or `NEXTAUTH_*` anywhere.

## 2. How pages load data

- **Client components + REST fetch (the norm):** `products/page.tsx`,
  `products/[id]/page.tsx`, `contacts/page.tsx`, `factories/page.tsx`,
  `settings/playbook/page.tsx` all start with `"use client"` and load via
  `fetch("/api/...")` inside `React.useEffect` on mount (e.g. products:
  `useState` + `useEffect`, `GET /api/products`; mutations via POST/PATCH/DELETE).
- **Server components (exceptions):** `actionables/page.tsx` is an async server
  component calling `listProducts()`/`listFactories()` from the store directly;
  `tonight/page.tsx` is a server `redirect("/dashboard/actionables")`.
- **No polling, no SWR:** grep for `setInterval|useSWR|swr|refreshInterval`
  under `src/app/(main)/dashboard` returns zero matches. Live updates (§1.1)
  do not exist yet — pages refresh only on navigation/remount.

## 3. Existing AI / agent code

- `src/app/api/spec-ai/route.ts` — POST `{name, amazonTitle?, bullets?, asin?}`.
  Calls the **Nous Portal** (`NOUS_API_KEY`, model `z-ai/glm-5.3-flash`) with a
  factory-spec prompt; falls back to a deterministic regex/parser heuristic when
  the key is missing or the call fails. Returns `{draft, ai}` — a **preview
  only**; the UI shows Approve/Discard and saves to spec notes on approval.
- `src/app/api/spec-ai-edit/route.ts` — POST `{fields, request}`. Nous-only
  (500s without key). Asks the model for the **full revised field list** as JSON,
  sanitizes it (unknown tags forced to `locked`), returns `{before, after}` —
  a proposal the UI must diff and apply only on explicit Accept. Never auto-applied.
- `src/lib/cc/guardrail.ts` — synchronous, deterministic regex guardrail, no AI
  call (safe to run inline on draft write). Four blocking rules: currency/price
  amounts, MOQ/minimum-order language, payment-terms language (deposit, T/T,
  L/C…), discount/counteroffer phrasing. Returns `{blocked, reason}`.

## 4. How Donna runs

- **Host/process:** `ark-vps`, user `openclaw`:
  `/home/openclaw/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main
  --profile donna-factory gateway run` (running, `Ssl`, since 01:27 UTC).
  (A second, separate `donna` Linux user runs its own `--profile donna` gateway.)
- **Profile:** `donna-factory`. Config:
  `/home/openclaw/.hermes/profiles/donna-factory/config.yaml` (~230 lines,
  `_config_version: 42`). Merged over the base `/home/donna/.hermes/config.yaml`
  style defaults; donna-factory model is `z-ai/glm-5.2` via Nous
  (`https://inference-api.nousresearch.com/v1`), `max_turns: 500`.
- **Platforms:** `email` enabled (Gmail IMAP/SMTP as `donna@everlastingicerx.com`,
  full HTML signature); **`whatsapp` enabled, `mode: bot`**, `bridge_port: 3001`,
  `dm_policy: open`, `group_policy: open`,
  `session_path: /home/openclaw/.hermes/profiles/donna-factory/platforms/whatsapp/session`
  (B3: do not touch), `home_channel: 19179571149` (Haim); `weixin` disabled.
- **Hermes version:** `Hermes Agent v0.21.1 (2026.9.7)`, upstream `9326d9cd`,
  install dir `/home/openclaw/.hermes/hermes-agent` (git method).
- **Not verified in this audit:** live WhatsApp bridge connectivity (gateway
  process is alive; the bridge socket on port 3001 was not probed, per B3
  caution) and gateway REST auth details.

## 5. SPEC §1.4 plugin APIs (Hermes source on VPS: `/home/openclaw/.hermes/hermes-agent`)

| API | Verdict + source path |
|---|---|
| `pre_gateway_dispatch` | **EXISTS.** `gateway/run_inbound.py` (lines ~45, 62: `{"action": "skip"}` → event dropped, with reason log); hook name registered in `hermes_cli/plugins.py` (~line 132). |
| `pre_tool_call` | **EXISTS.** Hook registry in `hermes_cli/plugins.py` (~line 108); block-veto enforcement via `get_pre_tool_call_directive` / `_get_pre_tool_call_directive_details` in `hermes_cli/plugins.py` (~lines 1771–1821), executed in `agent/tool_executor.py`. |
| `register_system_prompt_section` | **EXISTS.** `hermes_cli/plugins.py` line ~917 (`def register_system_prompt_section`). |
| Webhook platform (localhost run starter) | **EXISTS.** `gateway/platforms/webhook.py` — aiohttp server for HMAC-signed POSTs that render into agent prompts; `_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", …}` (line ~59), unauthenticated mode restricted to loopback. |
| General plugin API | **EXISTS.** `hermes_cli/plugins.py` (+ `hermes_cli/plugins_dispatch.py`) — hook registration/dispatch surface for plugins. |
| Documented programmatic "start one isolated agent run" entrypoint | **NOT VERIFIED** in this audit — the hook system and webhook platform above are confirmed, but which exact call starts a scoped run (and its concurrency limits) needs a deeper read before Goal 2. |

## 6. Current state (live: `https://command-center-review-tau.vercel.app`, via node fetch)

Pages/APIs (status = HTTP status of the live deployment):

| Target | Status | Verdict |
|---|---|---|
| `/dashboard/tonight` | 307 → `/dashboard/actionables` (followed: 200) | **working** (redirect is the spec'd behavior) |
| `/dashboard/actionables` | 200 | **working** |
| `/dashboard/products` | 200 | **working** |
| `/dashboard/products/[id]` (real id from `/api/products`) | 200 | **working** |
| `/dashboard/contacts` | 200 | **working** |
| `/dashboard/factories` | 200 | **working** |
| `/dashboard/activity` | 200 | **working** |
| `/dashboard/settings/playbook` | 200 | **working** |
| `/api/drafts` | 200, returns draft rows | **working** |
| `/api/settings` | 200, returns playbook settings JSON | **working** |

Buttons/controls (from reading `src/app/(main)/dashboard/products/[id]/page.tsx`, NOT by clicking):

- **FBA calculator — MISSING as a calculator.** The "FBA calculator (sheet)"
  Start-row only opens the product's `fbaSheetUrl` in a new tab if set, else
  scrolls to the spec card. `fbaSheetUrl` is a free-text URL input saved via
  PATCH. It **computes nothing and saves no results.** (Separately,
  `numbersFor()` in `src/lib/cc/engine.ts` computes landed/profit/margin from
  `Costs` — `landed = unitPrice*(1+duties%)+shipping; fees = sell*referral% +
  fbaFee + ppcUnit; profit = sell − landed − fees` — but it has **zero UI
  callers**; dead code. `Costs` defaults come from `blankCosts()`.)
- **AI Spec Draft — wired.** Button → `POST /api/spec-ai` (with ASIN lookup
  prefill) → draft preview → "Approve → save to spec" appends to
  `spec.notes` via PATCH, or Discard.
- **Send Yuki Brief — wired locally, does NOT send anything.** Preview dialog →
  "Confirm & send to Yuki" appends `{version, sentAt, content}` to the
  product's `yukiBriefs` via PATCH only. No WhatsApp/email call. (Spec Goal 0
  says "Copy Yuki Brief" — the actual button is "Send/Resend Yuki Brief".)
- **Spec PDF — wired.** "Download spec PDF" links to
  `GET /api/products/[id]/spec-pdf` (route dir confirmed in `src/app/api`).
- **Checklist toggles (Start card) — wired.** "Build spec sheet" toggles
  `specDone`, "FBA calculator (sheet)" opens link/scrolls, "Source factories
  (Yuki)" toggles `sourcingStarted` + stage `sourcing` — all via PATCH;
  checkbox + row click both work.
- **Star — MISSING.** No star control exists anywhere in the product-detail source.
- **Build spec sheet — wired** (see checklist; toggles `specDone`).
- **Source factories — wired** (see checklist; plus an "Add factory…" input
  that POSTs `/api/products/[id]/factories`).
- Also present and wired: Yuki brief checklist (6 text fields + box cutoff
  date, PATCH-saved), structured spec fields section (`SpecFieldsSection`
  with versions + `onSaved` reload), Master/Child SKU table, factory table
  with stub detail sheet ("being rebuilt — removed for now per Haim"),
  delete product.

## 7. Decisions

- **Anthropic-vs-Nous: RESOLVED Sep 16, 2026 — Nous Portal stays.** Haim chose
  to keep the working Nous setup (`NOUS_API_KEY`, `z-ai/glm-5.3-flash`) over
  SPEC §1.1's Anthropic API. Wherever SPEC says "Anthropic API"/CC_MODEL,
  build with Nous Portal instead.
- **Goal 2 plugin layout (Sep 16, 2026, verified against Hermes source, NOT
  just docs).** Directory plugin = `<root>/<name>/plugin.yaml` + `__init__.py`
  exposing `register(ctx)` (`hermes_cli/plugins.py:6-7`). Opt-in via
  `plugins.enabled` list (`plugins_discovery.py:90-99`; Donna's was `[]`, now
  `[command_center]`). Per-profile user plugins live in
  `$HERMES_HOME/plugins/` (= the profile dir for donna-factory). Hook
  contracts: `pre_gateway_dispatch` → return `{"action":"skip"}` to drop
  (`gateway/run_inbound.py:41-70`); `pre_tool_call` → return
  `{"action":"block","message"}` to veto (`plugins.py:1771-1811`).
  `register_tool(name, toolset, schema, handler, ...)` (`plugins.py:449`);
  `register_system_prompt_section(id, content, max_chars=4000)` (`plugins.py:917`).
  No existing plugin used `pre_gateway_dispatch` — command_center is the first.
- **Goal order rearranged by Haim (Sep 16, 2026).** Haim authorized building in
  the order that works best instead of SPEC numeric order: (1) messages
  visibility slice (thin read-only view of ingested chats/messages, normally
  Goal 6 timeline) so inbound flow is visible; (2) Goal 2 remaining live proofs
  (approved test draft sends once to CC Test; zero-LLM on empty queue);
  (3) Goal 4 product page; (4) Goal 5 AI Spec Draft; (5) Goal 3 contacts;
  (6) Goal 6 remainder (organizer + factory summary); (7) Goal 7 Actionables;
  (8) Goal 8 reply drafter; (9) Goal 9 follow-ups; (10) Goal 10 samples.
  Reason: each step is verifiable by Haim on screen before the next begins.
- **Goal 2 runtime scoping.** Job runner handles `cc-echo` inline; contacts/
  organize/etc. stay queued until Goals 3-8 land their skills (poll claims by
  type, so nothing is lost). Outbox sender posts bubbles to the local Baileys
  bridge `http://127.0.0.1:3001/send` (same path already proven by manual
  sends); email-thread rows fail visibly with a clear error. Ingest allowlist
  via `CC_INGEST_CHATS` (allowlist|all) + `CC_INGEST_ALLOW` (chat names/ids,
  default `CC Test`) read from Donna's `.env`; non-allowlisted chats keep
  current behavior (never silently dropped). Live WhatsApp send in CC Test
  itself is the pending proof (needs one fresh inbound message post-install).
- **Goal 1 logic modules are pure/in-memory, DB wiring later.** `approval.ts`
  takes an `ApprovalStore` (Maps) instead of touching Postgres, so the Agent
  API routes and dashboard actions will map real tables onto it; unit tests
  exercise every transition without a database. Same for `china-time.ts` /
  `holidays.ts` (pure functions + checked-in table).
- **Due-date model: wall-clock add, then push whole days past non-business
  days (time-of-day preserved).** SPEC's anchor (Friday 5pm + 24h = Monday
  5pm) rules out counting hours inside the 9:30–18:00 window (that would land
  Wednesday). "3 business days" is therefore read as 72 business-day hours
  under the same rule. `nextBusinessSlot` (9:30–18:00 window) is only for
  `send_after`, not for due dates.
- **Guardrail strips allowed content before matching** (fee message, CJK
  address runs, phones, dates, tracking numbers, spec numbers) instead of
  allow-listing after a match — so the exact fee card message (which names a
  price + wire transfer) passes. All patterns case-insensitive per §3.4.
- **2027 festival dates provisional.** 2026 table follows the State Council
  circular; 2027 lunar-mapped festivals (Spring Festival, Dragon Boat,
  Mid-Autumn) must be confirmed when the 2027 circular publishes. Golden Week
  Oct 1–7 fixed both years.
- **Goal 1 Agent API (Sep 16, 2026): isolated store, inline minimal logic.**
  All `/api/agent/*` routes persist to a NEW module `src/lib/cc/agent-store.ts`
  (file `data/agent.json` locally, `agent_kv` row in Postgres) and never touch
  `src/lib/cc/store.ts`, so the sibling task's §1.2 tables/store work there
  merges cleanly. No approval-engine/business-time imports: the sibling's
  `approval.ts`/`china-time.ts`/`holidays.ts` appeared mid-task as uncommitted
  in-progress work, so routes carry minimal inline equivalents (5-min lease in
  `claimOne`, CST clock stub in tick, sha256 content_hash in drafts);
  follow-up: rewire drafts/outbox/tick to `approval.ts`/`china-time.ts` once
  the sibling commits. Tick imports no AI SDK by design (never calls an LLM).
  Step-proof ack list implements §3.3 verbatim incl. 好的/收到/稍等 + emoji-only
  rejection. Blocked drafts return 422 + a `guardrail_block` question via the
  existing `checkGuardrail` (sibling is extending its reason strings; route
  only depends on `blocked`). `GET context` reads product/link/settings from
  the existing store and agent collections from the agent store; style examples
  and older-message summary are placeholders. Spec PDF serves
  `data|public/spec-<id>.pdf` or 501. Nothing committed/pushed/deployed.
- **Goal 1 data remainder (Sep 16, 2026): §1.2 collections in the main store,
  Undo in store + one route.** All 17 new §1.2 collections
  (`spec_versions`, `factory_products`, `adjustments`, `contact_channels`,
  `chats`, `chat_members`, `messages`, `outbox`, `questions`, `quotes`,
  `open_items`, `samples`, `shipments`, `shipment_items`, `notifications`,
  `activity_log`, `agent_jobs`) live in `src/lib/cc/store.ts` only — same
  dual-backend pattern as the existing code (`id TEXT PRIMARY KEY, data JSONB`
  tables, parent-id column where lists are parent-scoped, local-JSON keys in
  `LocalData` + `EMPTY_LOCAL`/`LOCAL_LIST_KEYS`). The sibling's
  `src/lib/cc/agent-store.ts` (`data/agent.json`) is untouched and stays the
  Agent API's store; the two overlap in meaning but not in rows. Undo reuses
  the pure `planUndo` already in `types.ts`: `undoActivityEntry(id)` in the
  store applies the plan (restore before-state, or delete when before is null)
  across all 17 collections + `contacts`, then stamps `undoneAt`; double-undo
  is refused (`planUndo` returns null once `undoneAt` is set).
  `POST /api/activity/undo` (`{id}` → 404/400/200) is a thin wrapper over it.
  Local JSON keys use the existing camelCase convention (`specVersions`,
  `factoryProducts`, …); pg table names match SPEC §1.2 verbatim.
  Nothing committed/pushed/deployed.
- **Messages visibility slice (Sep 16, 2026, step 1 of reordered goals).**
  `GET /api/messages` (`chat_id?`, `limit` default 50/max 200, newest-first
  `[{id, chat_id, chat_name, sender, direction, text, translation, sent_at}]`)
  reads the agent store read-only; sender resolves `contact_id` via contacts.
  No token gate: `proxy.ts` is still disabled (`proxy.disabled.ts`) and the
  other dashboard APIs (`/api/contacts`, `/api/actionables`) are likewise
  open, so gating just this one would break the page while adding no real
  protection — revisit when dashboard auth is enforced globally. Activity page
  (was placeholder) now hosts a thin client `MessagesView`: chat dropdown,
  10s polling, in/out bubbles with translation under the original. View at
  `/dashboard/activity`. Test `tests/unit/agent-messages.test.ts` tags its
  rows (shared file-backed store leaks between test files) and cleans up.
  `npm run build` green; `test:unit` 8 files/119 tests green; typecheck green.
  Nothing committed/pushed/deployed.

## Sources checked

- Local repo: `package.json`, `src/lib/cc/store.ts` (lines 1–100),
  `src/app/api/spec-ai/route.ts`, `src/app/api/spec-ai-edit/route.ts`,
  `src/lib/cc/guardrail.ts` (all read in full); `src/proxy.disabled.ts`;
  greps for auth (`login|auth|middleware|next-auth|clerk`), env vars,
  `use client`/fetch/SWR/polling, FBA/star/pdf/Yuki strings;
  `src/app/(main)/dashboard/{products,products/[id],contacts,factories,actionables,tonight,settings/playbook}`;
  `src/lib/cc/engine.ts` + `src/lib/cc/types.ts` (FBA); `vercel ls`, `vercel alias ls`.
- VPS (`ssh ark-vps`): donna-factory config
  (`/home/openclaw/.hermes/profiles/donna-factory/config.yaml`), gateway
  processes (`ps aux`), Hermes version (`--version`), plugin API greps in
  `/home/openclaw/.hermes/hermes-agent` (`hermes_cli/plugins.py`,
  `gateway/run_inbound.py`, `agent/tool_executor.py`, `gateway/platforms/webhook.py`).
- Live: node-fetch status checks of 9 URLs + 1 product-detail page on
  `command-center-review-tau.vercel.app` (git-bash curl avoided per TLS issues).
- Goal 3 (Sep 16, 2026): Agent API contacts routes
  (`src/app/api/agent/contacts/route.ts` + `[id]/route.ts` + `merge/route.ts`),
  ingest route (contacts jobs queued as `{chat_id, message_id}` — minimal,
  no sender snapshot), jobs claim, context; `src/proxy.ts` (dashboard APIs
  login-gated, Agent API bearer-only); VPS session creds `me.id`,
  bridge `/health`, donna-factory config `external_dirs`, gateway process
  list, installed plugin copy.

## 8. Goal 3 contacts processor (Sep 16, 2026)

- **No-LLM contacts path.** The poller now claims `contacts` jobs too
  (`HANDLED_JOB_TYPES = {"cc-echo", "contacts"}`) and runs them through
  pure functions (`detect_self_stated_role`, `plan_contacts_actions`,
  `_execute_contacts_actions`) — regex plus exact/substring matching,
  zero LLM calls. Skill `hermes/skills/cc-contacts/SKILL.md` (§1.5
  frontmatter + When to Use/Procedure/Pitfalls/Verification) documents
  the same procedure. Installed in-repo, in the VPS plugin copy, and in
  the VPS skills dir (`/home/openclaw/command-center/hermes/skills/`,
  which is what donna-factory `external_dirs` points at). Only the
  donna-factory gateway was restarted (old PID 2681266 → 2693321, runs as
  `openclaw`); the `donna` gateway (PID 1893255) and all others untouched.
  Restart is systemd-user supervised, so kill was followed by automatic
  revive — verified all 8 gateway processes alive, email+WhatsApp
  connected.
- **Rules encoded.** Unknown group sender → create (`type factory`,
  chat factory or blank, `sales_agent`/`default`, templated
  `WhatsApp <id> in <chat>` description, never invent roles/companies).
  Role changes only on self-statement (`i am`/`i'm`/`my name is`/`this is`
  + role word → sales_agent/designer/logistics/owner_manager/qc/other),
  with `role_note` = their sentence, `role_source` = `self_stated`,
  `role_proof_message_id` = message text. Third-party descriptions never
  change roles. Email: exact channel → attach; else domain/company/
  signature substring vs known factories → create with that factory;
  else Unmatched entry (blank factory, `Unmatched sender` description).
  Signature phone/email matching an existing channel → merge endpoint.
  Every automatic action logs a `command_center: contacts ...` gateway line.
- **Ours seeds (via Agent API, production).** Haim (`ours`, email
  haim@everlastingicerx.com + WhatsApp 19179571149, 9294207308, contact
  id `d7f60emosspb`) and Donna (`ours`, WhatsApp 12292566515, id
  `ks6lypp6ssst`).
- **Donna's number: 12292566515.** From session `creds.json` `me.id`
  (`12292566515:3@s.whatsapp.net`, name "Donna Levine"; read-only, B3
  intact) with bridge `/health` = `connected`. JID device suffix `:3`
  stripped.
- **Yuki: NOT found — flagged for Haim.** No Agent-API endpoint lists
  chats/messages/contacts (dashboard `/api/chats`, `/api/contacts` are
  login-gated per `src/proxy.ts`), so no certain Yuki number exists.
  Do NOT guess; Haim must supply it, then seed like Donna.
- **Server schema gaps (follow-ups, need deploy).** `PATCH
  /api/agent/contacts/:id` accepts no `channels` (channel attach only at
  create or via merge — logged, never faked); POST contacts has no
  `company` field (`Unmatched` encoded in description); production ingest
  queues minimal `{chat_id, message_id}` contacts payloads with no sender
  snapshot, so live jobs take the log-only path until ingest embeds the
  snapshot (plugin handles both shapes).
- **Verification (no production test writes).** `/tmp/sim_contacts.py`
  on VPS ran against the installed file in dry-run: 22/22 checks
  (create-default, self-role PATCH+proof, third-party no-op, email
  attach, Unmatched, merge keep/merge ids, minimal-payload log-only,
  zero HTTP calls in dry-run, role unit cases). Simulation itself caught
  and fixed two bugs (tuple mutation in create-fold, email early-return
  skipping merge). Nothing committed/pushed/deployed.

## Still needs live traffic

1. First real unknown sender in an allowlisted group → contact created
   within 60s (gateway `contacts ... create` line + contact row).
2. First real self-stated role ("I'm X, the logistics manager") →
   role `logistics`, `role_source self_stated`, proof linked.
3. First real signature/phone cross-channel match → merge row.
4. Post-restart `command_center: background workers started` line
   appears on the next inbound event (workers start lazily); confirm
   then.
5. One transient `POST /api/agent/jobs/claim HTTP 500` seen pre-restart
   (16:11:35 UTC) — watch whether it recurs.
6. Yuki's WhatsApp number from Haim, then seed + verify.
7. Deploy-time follow-ups: ingest sender snapshot in contacts payloads;
   `channels` on PATCH; `company` on POST contacts.
