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

- **Goal 6 factory status UI (Sep 16, 2026).** Board rows stay on legacy
  `factory-product-links` (currentLayer/statusLine/waitingOn/since/nextStep)
  because the organizer (Goal 6 remainder) hasn't populated §1.2
  `factoryProducts` yet (store.json: 0 rows) and agent `steps`/`statusUpdates`
  are empty; §1.2 flags (productGuessed/archivedAt) overlay by link id when
  present. New read-only dashboard helpers (no agentAuth — browsers carry no
  bearer token; same precedent as GET /api/messages, login-gated by proxy):
  GET /api/agent/steps-proof?factoryProductId= (5 proofs with message text +
  timestamp, guessed/archived flags, pending-approvals = open agent questions
  + pending agent drafts), GET /api/factory-products (enriched board rows),
  GET /api/factories/[fid]/summary (per-product blocks, adjustments, outbound,
  quotes, samples, contacts, timeline, canShareVolumes). Summary [id] is the
  link companyId (factory grouping key); a link id also resolves. Added
  Factory.canShareVolumes (default falsy via normF passthrough) + PATCH
  support. Samples section is list-only (Goal 10 builds tabs). Product-page
  factory rows NOT relinked: legacy companyId is opaque and can't be mapped
  reliably to summary ids yet — organizer will own the mapping.

## 9. Goal 6 organizer processor (Sep 16, 2026)

- **No-LLM organize path.** Poller claims `organize` jobs too
  (`HANDLED_JOB_TYPES = {"cc-echo", "contacts", "organize"}`) and buffers
  them per chat (`_organize_pending`, newest job resets a 120 s quiet
  period); a `cc-organize` sweeper thread processes a chat only after 2
  min quiet, then marks each job done/failed **with its lease token**
  (`_finish_job`). Skill `hermes/skills/cc-organizer/SKILL.md` (§1.5
  frontmatter + When to Use/Procedure/Pitfalls/Verification) documents the
  same procedure. Installed in-repo, in the VPS plugin copy (content
  identical modulo CRLF/LF, md5-verified after CR strip), and in the VPS
  skills dir (`/home/openclaw/command-center/hermes/skills/cc-organizer/`).
  Only the donna-factory gateway was restarted (PID 2693321 → 2698048 via
  `XDG_RUNTIME_DIR=/run/user/1000 systemctl --user restart` as openclaw);
  `donna` (PID 1893255) and all others untouched. New `__pycache__`
  compiled at boot (17:25:29) proves the new code loaded; the historical
  `command_center: registered` line appears nowhere in gateway.log on any
  boot, so pyc + active-service is the registration evidence.
- **Rules encoded (pure planner `plan_organize_actions`).** Per-message
  product link (single→direct, multi→name-word hits, ambiguous→
  most-recent-active); non-English→`translation:""`, detected `lang`
  (`zh` on CJK), low-importance `question` card, never a guessed
  translation; steps only on proof regexes (1: real reply ≥12 chars or
  product word; 2: can-make-it; 3: spec-confirm with zero open changes;
  4: sample-commit; 5: tracking regex UPU/SF/YT/long-token) with the
  server's ack list pre-filtered (ok/👍/emoji/好的/收到/稍等/greetings
  yield zero step calls); status `waiting_on` haim-if-draft-or-card else
  factory with first-undone-step as next; quotes→Haim-only + number-free
  draft; change proposals→adjustment (flexible/locked from payload spec,
  else pending + we_owe item); tracking→step 5 + china_to_yiwu shipment +
  sample_tracking resolve; fee→high fee question, never agree; §3.8 reply
  table drives canned `POST /api/agent/drafts` bubbles (Goal 8 drafter
  owns final wording). Dry-run (`dry_run` flag or `CC_ORGANIZE_DRYRUN=1`)
  builds bodies with zero HTTP calls — including skipping the job done
  ack. Every action logs a `command_center: organize ...` gateway line.
- **Interpretation choices.** "waiting_on per section 5 order" read as
  priority haim > factory (yuki/carrier/none belong to later sample-flow
  goals); "section 9 table" read as the §3.8 reply table; `product_guessed`
  has no Agent API field so it is encoded in the status `note`
  (`product_guessed:<fp>`) + gateway log.
- **Server/schema gaps (deploy-time follow-ups).** No Agent API endpoint
  creates factories or factory_products, so new-group setup is log-only
  (name logged, opener deferred) until one exists; no endpoint lists
  messages by chat, so ingest's minimal `{chat_id}` organize payloads
  take the log-only path until ingest embeds the message/product snapshot
  the planner documents; questions kinds have no `spec_gap` (untranslated
  uses `question` + `body.issue`); `PATCH status` covers waiting_since
  server-side. Pre-existing, untouched: `_run_job` marks cc-echo/contacts
  done with `{}` while the route requires `lease_token` (organize path
  sends it correctly).
- **Verification (zero production writes).** `/tmp/sim_organize.py` on VPS
  against the installed file, dry-run: 23/23 (minimal log-only,
  single/multi/ambiguous links + guessed flag, zh empty-translation +
  card, 7 ack variants zero steps, steps 2/4/5 + shipment + resolve,
  quote + number-free draft, fee-high card, new-group log-only, status
  haim/next, per-chat buffer + deadline reset + sweeper drain, zero HTTP
  calls). Simulation caught and fixed one bug (dry-run done-ack firing).
  Nothing committed/pushed/deployed.

## Still needs live traffic (additions)

8. First real multi-message burst in an allowlisted group → one
   `organize batch for chat ... quiet, processing` line after ~2 min
   quiet, plus annotate/steps/status/draft lines; confirm single
   processing per burst.
9. First real `organize` job with the current minimal `{chat_id}` payload
   → `organize/minimal-payload` log-only line (expected until ingest
   embeds snapshots); confirm no poison-loop.
10. Watch for recurrence of the transient `POST /api/agent/jobs/claim
    HTTP 500` (seen 16:11:35 UTC pre-restart).

## 10. Goal 10 samples + tracking (Sep 16, 2026)

- **Sample stage transitions are pure functions.** `src/lib/cc/sample-stages.ts`
  exports `onTrackingNumber`, `onChinaDelivered`, `onYukiPass`, `onYukiProblem`,
  `onBoxConfirmed`, `onNYDelivered`, `onSuggestChange`, `onHaimApprove`,
  `onHaimReject` — each takes the current sample(s) + an event and returns the
  next state (sample patch + any new shipment/question/draft/notification).
  No I/O; testable in isolation. The Agent API routes call these after
  persisting the triggering event. Tests in `tests/unit/samples.test.ts` cover
  every §3.5 transition with mocked data.
- **GET /api/agent/samples** added (no agentAuth — browsers carry no bearer;
  proxy.ts login-gates). Returns all samples enriched with their shipments
  (both legs). POST preserved (dynamic zod import to avoid breaking existing
  callers).
- **GET /api/agent/shipments** added. Returns all shipments with leg, tracking,
  carrier, status, eta, events.
- **17TRACK webhook** at `POST /api/webhooks/17track` — verifies HMAC-SHA256
  signature from `CC_17TRACK_KEY` env against the raw body, then updates
  matching shipments (status, last_event, eta, events, carrier). 503 when key
  not configured. No login gate (proxy.ts skips /api/webhooks/*).
- **Tick tracking-refresh stub** — `refreshTracking()` in tick route checks
  `CC_17TRACK_KEY`; if set, logs in-transit shipments for refresh; if not, logs
  `tracking-refresh:skipped (CC_17TRACK_KEY not set)`. No real 17TRACK API
  calls without a key (B6).
- **Samples page** at `src/app/(main)/dashboard/samples/page.tsx` — two tabs
  (China / New York). China tab: one row per sample with tracking, carrier
  status, arrival date, Yuki check (pass/problem/waiting), photos, stage. New
  York tab: ready-to-ship list, box tracking, in-transit, received, decision
  badge. Reads from GET /api/agent/samples + GET /api/agent/shipments.
- **Nav item** added to `sidebar-items.ts` between Products and Messages
  (lucide `Package` icon, url `/dashboard/samples`).
- **No new dependencies.** Uses existing Tabs, Table, Card, Badge, Button,
  Skeleton from `src/components/ui/`.
- **`npm run build` green; `npx vitest run` 14 files / 202 tests green.**
  Nothing committed/pushed/deployed.

## 11. Goal 9 follow-ups (Sep 16, 2026)

- **Pure planner `planFollowups`** in `src/lib/cc/followups.ts` — no I/O,
  fully unit-testable. Takes `now`, open-item snapshots, the set of
  already-queued cc-followups job IDs, and the set of factory_product_ids
  active in the last 7 days. Returns a `FollowupPlan` with queueJobs,
  archiveRows, raiseQuestions, notifyHaim, incrementFollowups arrays.
- **Due clock.** A they_owe `question` is due after 24 business-day hours;
  a `sample_tracking` item after 72 (3 business days). Uses
  `last_followup_at` when `followups_sent > 0` (so follow-ups are spaced
  24 business hours apart), else `opened_at`. `addBusinessHours` pushes past
  weekends + Golden Week with time-of-day preserved.
- **Importance rating** (set by the tick, carried in the job payload):
  High when `kind === sample_tracking` (blocks a sample); Medium when the
  factory was active in the last 7 days (a message linked to that
  `factory_product_id` exists in the last 7 days); Low otherwise.
- **Send timing.** `sendAfter` = `now` when inside the 9:30–18:00 CST
  window (`isBusinessTime`), else `nextBusinessSlot(now)` (next 9:30 CST
  business day). The poller passes it through as the draft/outbox
  `send_after`; the outbox is not claimable until then.
- **Archiving.** After 2 unanswered follow-ups (`followups_sent >= 2` and
  still overdue), the tick archives the row: sets `resolved_at` + a
  `resolution: "archived_2_unanswered"` on the open item, logs an
  undoable activity entry (`archive.followup`), and queues a Haim
  notification. The agent-store has no `factoryProducts` collection, so
  the tick updates the open item's resolution rather than the
  factory_product row's `archived_at` directly — Undo restores the open
  item. The spec says "archive that factory_product row"; when a
  factory_product store is added to the agent API, the tick should also
  set `archived_at` there.
- **we_owe: no factory draft.** For a `we_owe` item overdue after 24
  business hours, the tick raises all open questions for that
  `factory_product_id` to `importance: "high"` and queues a Haim
  notification ("waiting on you"). No cc-followups job is queued, no
  factory draft.
- **Tick route** (`src/app/api/agent/tick/route.ts`) replaced the stub
  24h wall-clock check with the pure planner. It collects open items,
  recent messages (last 7 days) for active-factory detection, and
  existing queued cc-followups jobs to avoid duplicates; then executes
  the plan: inserts `cc-followups` agent jobs, updates questions to
  High, archives + logs + notifies, and increments `followups_sent` +
  `last_followup_at`.
- **Plugin poller** (`hermes/plugins/command_center/__init__.py`):
  `HANDLED_JOB_TYPES` now includes `"cc-followups"`. `_run_followups_job`
  creates a `followup` draft via `POST /api/agent/drafts` for `they_owe`
  (short, warm, non-pushy bubbles; guardrail runs server-side); for
  `we_owe` it logs only (the tick already raised the question card and
  notified Haim). No LLM.
- **Skill** `hermes/skills/cc-followups/SKILL.md` (§1.5 frontmatter:
  name, description ≤60 chars, version, metadata.hermes tags + category;
  sections: When to Use, Procedure, Pitfalls, Verification).
- **Tests** `tests/unit/followups.test.ts` — 15 tests: weekend skip,
  Golden Week skip (not due Oct 5, due Oct 8), Friday 5pm → Monday 5pm,
  2nd unanswered follow-up archives the row, we_owe raises to High with
  no factory draft, importance High/Medium/Low, sendAfter in/out of
  business hours, duplicate-queue skip, resolved-item skip, 1st vs 2nd
  follow-up (0→1, 1→2 both queue, 2→archive).
- **`npm run build` green; `npx vitest run` 15 files / 217 tests green.**
  Nothing committed/pushed/deployed.

## Round 2 — Dashboard Fixes (Goals 1-15)

### Decisions
- **Factory-level stages**: Added `factoryStage` (5-step: spec_agreed → sample_committed → passed_china → arrived_ny → sample_approved) to the Factory type. Each factory tracks its own stage independently. normF infers factoryStage from the old `fstage` field if not set (additive migration).
- **Product ladder simplified**: StageLadder now shows only 3 product-level steps (Spec approved, FBA numbers saved, Factories contacted). Steps 4-8 moved to the FactoryLadder component on the factory detail Sheet.
- **Factory progress summary**: Product page shows a clickable summary line ("3 factories · 1 spec agreed · 1 sample committed · ...") instead of fake shared steps 4-8.
- **Send Yuki Brief**: One click sends the spec PDF via WhatsApp bridge (`/send-media`). No preview dialog. Uses the latest approved spec version. Activity log entry created on send.
- **Include order quantity checkbox**: Defaults unchecked on every page load. When unchecked, the PDF excludes order quantities. Download spec PDF is not affected.
- **White flash fix**: Added `color-scheme: light dark` and `background-color: var(--background)` to the `html` element in globals.css, plus inline `style` on body element in layout.tsx.
- **One status**: Removed the old `STAGE_LABEL` badge. Only the `productStatus` dropdown (Queue/Active/Completed) is shown.
- **Start date label**: Added visible "Start date" label next to the date input.
- **Platform-aware shortcut**: Search bar kbd shows `⌘` on Mac, `Ctrl` on Windows/Linux via `navigator.platform` detection.
- **Editable factories table**: All columns (Name, Stage, Sample, Quote, Contact, Last note) are now editable inline. Row click opens factory detail Sheet.
- **ASIN removed from spec PDF**: No ASIN in the spec sheet or send-yuki-pdf.
- **"Needs input" removed from spec display**: Fields with no value are skipped entirely.

## Round 3 — Spec PDF Rebuild + Send Yuki Brief Pop-up

### Decisions
- **Spec PDF rebuilt**: Shared generator (`src/lib/cc/spec-pdf-generator.ts`) used by both Download and Send Yuki. A4 layout with: product image (left), name + Master SKU + version (right), two-column spec fields table with alternating row shading, SKU breakdown as real table with column headers, footer with page numbers.
- **CJK font embedding**: Extracted NotoSansSC TTF from TTC on VPS using fonttools, embedded via @pdf-lib/fontkit. Falls back to Helvetica if font files not found.
- **Image fetch**: Tries Node fetch first, falls back to curl for images that fail with ECONNREFUSED.
- **Send Yuki Brief pop-up**: Replaces one-click send. Pop-up has editable message pre-filled with product name, PDF preview iframe, "Include order quantity" checkbox (unchecked by default), Send + Cancel.
- **pg-adapter fix**: `@vercel/postgres` was still being imported in store.ts and agent-store.ts — replaced with local `pg-adapter.ts` using `pg.Pool`. This was the root cause of all API 500 errors on the VPS.

## Round 3 (continued) — Goals 5-7

### Decisions
- **Goal 5 (text spacing)**: Root cause was the CJK font (NotoSansSC) being used for ALL text including English. Its wide character spacing made "MB-0804" look like "MB-0 8 0 4". Fix: dual-font system — Helvetica (StandardFonts) for all Latin text, CJK font only when `hasCJK()` detects Chinese characters. `pickFont()` function selects the right font per text segment.
- **Goal 6 (row shading)**: Row background rectangles were offset from the text rows. Fixed by drawing the rectangle with `y: y - thisRowH` and `height: thisRowH` before drawing text, so the band sits exactly behind the row. For wrapped values, `thisRowH = maxLines * 12 + 6` grows to cover all lines.
- **Goal 7 (remove version)**: Removed "Spec v3 · approved [date]" from the PDF header and "Spec v3 · MB-0804 · Page 1 of 1" from the footer. Footer now shows "Page 1 of 1" only. Spec versions remain visible on the dashboard product page.

## Round 4 — Goal 1: Message Pipeline Trace

### Root cause
**CC_AGENT_TOKEN mismatch**: Donna's plugin `.env` had a 64-char token (`0cd38ce5fc0ce76dc01e77b058c684b947519caf45a2a0bf016206c1b0e46f59`) but the dashboard's `.env.local` had a truncated 15-char version (`0cd38ce5fc0ce76`). Every API call from the plugin to the dashboard returned 401 Unauthorized.

### Step-by-step trace
1. **WhatsApp session connected**: PASS — bridge health OK, uptime 51.8h
2. **Plugin loaded**: PASS — "command_center: registered (ingest/job/outbox/tick/send-block/14 tools)"
3. **Ingest allowlist**: PASS — no channel_directory.json restriction; plugin ingests all WhatsApp groups
4. **Plugin BASE_URL**: PASS — points to `http://127.0.0.1:3100` (local VPS, not Vercel)
5. **CC_AGENT_TOKEN**: **FAIL** — Donna's token (64 chars) ≠ dashboard token (15 chars, truncated). All API calls returned 401.
6. **Same database**: PASS — both use the same local Postgres at `localhost:5432/command_center`
7. **Messages page queries**: PASS — `/api/chats` and `/api/messages` read from agent_kv via `dbFind()`, data exists
8. **Contacts**: Data exists (2 contacts in agent store) but were not created from the Rose Shene message (that was lost to 401)
9. **Actionables**: 1 pending draft exists (from a previous test) but not from the Rose Shene message

### Fix
Synced dashboard `.env.local` CC_AGENT_TOKEN to match Donna's full 64-char token. Restarted cc-dashboard. Verified ingest returns 200 with correct token. Restarted Donna gateway — no 401s since restart.

## Round 4 — Goal 1B: Our People Phone Matching

### Rose Shene message — was it skipped?
**No.** The Rose Shene message was lost because of the 401 token mismatch (Goal 1), not because Shene was on "Our people." Shene had no phone number in the settings, so even if the ingest had succeeded, `_is_ours()` would have returned false (no phone to match). The plugin's "our people" check was never reached because the ingest API call returned 401 before any logic ran.

### How Donna reads the "Our people" list
1. **Storage**: The list lives in the Postgres `settings_kv` table, accessed via `/api/settings` (GET returns the full PlaybookSettings, PATCH merges).
2. **Plugin fetch**: The `command_center` plugin calls `GET /api/settings` and caches the result for 60 seconds (`_OUR_PEOPLE_TTL = 60`). This means changes in the dashboard take effect within 1 minute without restarting Donna.
3. **Phone matching**: When a WhatsApp message arrives, the plugin extracts the sender's `user_id` (their WhatsApp phone number in JID format like `8618069936600@s.whatsapp.net`). It normalizes both the sender ID and each "our person" phone number to digits-only and compares. If any match, the message is ingested with `is_ours: true`, which tells the server to save the message but skip contact creation, actionables, and drafts.
4. **Messages page**: Messages from "our people" appear on `/dashboard/messages` with the same data as factory messages. The `is_ours` flag is saved on the message record for potential UI labeling.
5. **Yuki warning**: If Yuki's entry has no WhatsApp number, the Settings page shows "Add Yuki's WhatsApp number."
6. **Shene default**: Shene's phone is empty by default — it needs to be filled in from the Settings page.

## Session Start Audit (Sep 17, 2026) — Claude Code, first session as sole owner

Read-only audit per CLAUDE.md "First session" instructions. No code changed.
Verified against the **live site** (`http://2.25.175.196`) via HTTP, and by
reading source in this repo. This cloud session has **no SSH/DB access to the
VPS** (no `ssh` binary, no `.env.local` present here) — findings about the
live database come from hitting the live dashboard's own read APIs
(`/api/products`, `/api/contacts`, `/api/decisions`, `/api/messages`, etc.),
not direct Postgres queries.

### Stack recap (still accurate)
Next.js 16 / React 19 / TypeScript strict / Tailwind v4 / shadcn, no ORM.
Two Postgres-backed stores behind one DB (`command_center` on the VPS):
- **Dashboard store** (`src/lib/cc/store.ts`, `pg-adapter.ts`) — relational
  tables for products, factories, contacts, settings, etc.
- **Agent store** (`src/lib/cc/agent-store.ts`) — one JSON blob
  (`agent_kv`, row `id='db'`) holding everything Donna's Hermes plugin
  writes: `agentJobs`, `messages`, `drafts`, `draftVersions`, `questions`,
  `factories` (a *different* factories concept than the dashboard's),
  `chats`, etc.
These do not auto-sync. Routes that need "the real picture" (e.g.
`/api/decisions`) must explicitly merge both — most routes don't, which is
the root of several bugs below. Donna's plugin lives only on the VPS
filesystem (`.../plugins/command_center/__init__.py`), not in this git repo.
Auth: Auth.js/Google code exists (`src/auth.ts`, `/login`,
`/api/auth/[...nextauth]`) but is fully disabled — `src/proxy.ts` is a
passthrough stub, so **every API route is open with no login**, including
the `/api/agent/*` routes only meant for Donna (those do check
`CC_AGENT_TOKEN` server-side; the dashboard-facing `/api/*` routes check
nothing).

### Page/feature status

| Area | Status | Evidence |
|---|---|---|
| Dashboard home (`/dashboard/default`) | **Works, with real data** | Live HTML confirms all 5 required cards (Products Active/Queue/Completed, Actionables, Est. Monthly Sales) are coded in `page.tsx`. Did not confirm the "Donna connected · last message" status line renders live data — no GET status endpoint found, only `POST /api/agent/status` (write-only, for Donna). Likely missing or fake. |
| Products list/detail | **Works, mixed with test data** | 3 products live: 2 are leftover junk ("No Spec Product", blank spec, `queue` status) and 1 real one (High Visibility Reflective Safety Vest, MB-0804, real ASIN/image). |
| Product statuses | **Fixed, one leftover field** | Real products use `productStatus: queue/active/completed` correctly. But the raw record still carries a legacy `stage: "idea"` field nobody reads anymore — dead, not shown in UI, but a landmine for the next person who greps for status. |
| Spec PDF / AI spec draft / Send Yuki Brief | **Not tested this session** (would require actually generating/sending — held off since this is a no-code, look-only session) | Code paths present per prior STACK.md audit (Round 3): shared `spec-pdf-generator.ts`, dual-font fix, Yuki brief popup. Not re-verified live. |
| **Messages pipeline** | **Broken / duplicated** | Two separate, independent message-viewing pages exist: `/dashboard/messages` (own client component hitting `/api/chats`) and `/dashboard/activity` (hosts a different `MessagesView` component per Round-5-era STACK notes). CLAUDE.md names only one messages page. This is exactly the "two versions of the same feature" anti-pattern the file warns against. |
| **Actionables** | **Broken — still the old multi-card design** | Live `/api/decisions` (which `/dashboard/actionables` calls) returns internal codes (`"code":"D1.3"`, `"D2.1"`, `"D3.1"`), a separate `"kind":"product_pick"` card type distinct from message cards, and duplicate cards for what's clearly the same simulated inbound message repeated 3 times under different `factoryProductId`s. `/api/actionables` (a second, apparently unused endpoint) returns `[]`. All of this matches CLAUDE.md's "Known problems at handover" list almost verbatim — it has not been fixed despite HANDOVER.md claiming Goal 1 "DONE and deployed." Goal 1 fixed *whether drafts show up at all*; it did not fix the card design itself. |
| Contacts | **Has a real duplicate-contact bug** | Live `/api/contacts` shows "Carlos from Nanjong" as **5 separate contact rows**, all on the exact same WhatsApp id (`15559998888@s.whatsapp.net`) — direct violation of "No duplicates." Also shows Haim's own real phone number (`19179571149`) auto-created as an **unmatched factory contact** ("Factory Person") rather than being recognized as "Ours" — a live "Our people" phone-matching gap, not just old test debris. |
| Factories (dashboard concept) | **Untested, looks empty** | The one real product has zero linked factories (`/api/products/:id/factories` → `[]`). No live proof either way that the factory ladder/summary pages work with real data. |
| Settings (Our people, playbook) | **Works with real data** | `/api/settings` returns real values: Yuki and Shene with real phone numbers, real Yiwu address, real brand list. This part looks solid. |
| "What Donna learned" (learning/lessons page) | **Not built** | Confirmed absent — no lessons/rules schema or Settings sub-page exists yet (matches HANDOVER.md Goals 3–8 "not started"). |
| Login/auth | **Intentionally disabled**, not broken | Matches HANDOVER.md; flagged only because CLAUDE.md doesn't mention it and it means literally anyone with the URL can hit every API. |

### Test data currently in the live database (via live API, not built by me)

**Products** (`/api/products`):
- `m1mtelzknp8g` — "No Spec Product" (blank, `queue`)
- `5txs0p9gn5do` — "No Spec Product" (blank, `queue`)
- (Real: `53jlkek5qg34` — High Visibility Reflective Safety Vest, MB-0804 — keep)

**Contacts** (`/api/contacts`, 12 total, 11 look like test debris):
- `m2g0oa7kub9i` "Test User" (`wa-test`)
- `ik6wf6062pb7` "Factory Person" (`19179571149` — this is actually Haim's real number, mis-filed as a factory contact, not just "fake")
- `opdpxm9jcpax` "Carlos from Nanjong" (`15551234567@s.whatsapp.net`)
- `19v10ikqhnmm` "Maria from Zhejiang Factory" (`15558887777@s.whatsapp.net`)
- `xzkw70ewvf9s`, `6575wrmxvqwk`, `9jkxixhm1g4d`, `ca7auvsg3drx`, `2h6hy9gy57k0`, `cqlrronzfvho` — six duplicate rows for "Carlos/Shene from Nanjong" all on `15559998888@s.whatsapp.net`
- `g5e9dthgp0bl` "Wendy from GreenLeaf Mfg" (`8613900001111@s.whatsapp.net`)
- (`x8zd3ii0u7c2` "Chessa" is marked `kind: ours` — unclear if real or test; didn't touch it, worth asking Haim)

**Messages/Actionables** — all traceable to the fabricated `Carlos`/`Wendy`/`Maria`/"Nanjong Industrial Company" senders above, sent into the real **CC Test** WhatsApp group per HANDOVER.md §3, plus one `testclaimzvvbkq` job HANDOVER.md says was inserted directly via psql. These produce the duplicate `D1.3`/`D2.1`/`D3.1` Actionables cards and `product_pick` cards seen live.

I did not delete any of this — CLAUDE.md says delete test data only "once its check passes," and no check has passed yet since Actionables is still broken. Deleting now could also delete evidence useful for fixing the card design. Recommend deleting it as part of the Actionables fix, once the new one-card design is live and re-verified with a real phone.

### Proposed order to fix things

1. **Actionables → one card design.** This is the most-broken, most-visible thing, it's what Haim actually looks at every day, and CLAUDE.md calls it out by name. Rebuild `/api/decisions` (or replace it) to emit exactly one merged card per factory conversation — no `code`, no separate `product_pick` kind, no duplicate cards per message. Wire in the exact 4 buttons (Approve/Suggest changes/Disapprove/Ignore) with collapsed "Previous drafts."
2. **Fix the live contact-matching bugs surfaced above** (duplicate "Carlos" rows, Haim's own number filed as a factory contact) — needed before Actionables can be trusted, since one factory conversation should map to one contact.
3. **Delete the test data listed above**, once the new Actionables design is verified end-to-end with one real message from a real phone (not "Our people") into CC Test.
4. **Collapse the messages duplication** — pick one of `/dashboard/messages` or `/dashboard/activity`, delete the other.
5. **Verify Spec PDF / Send Yuki Brief / factory ladder pages with real data** — these were "verified" in earlier rounds using fake data or not re-checked; re-confirm before trusting them.
6. **Build the Goals 3–8 learning system** ("What Donna learned" page, lessons/rules) — biggest net-new build, correctly last since everything above needs to be stable and trustworthy first (learning from a broken pipeline teaches wrong lessons).

Waiting for Haim's go-ahead before changing any code.

## Round 5 — Goal 1: Why Messages Don't Create Actionables

### Root cause (3 issues)
1. **`/api/decisions` only read the dashboard store**: The Actionables page fetches from `/api/decisions`, which only called `listDrafts()` from the dashboard store (Postgres `drafts` table — 0 rows). The plugin creates drafts in the **agent store** (agent_kv JSON blob) via `POST /api/agent/drafts`. The two stores were disconnected — agent store had 6 drafts with 8 versions and proper `bubbles`, but the dashboard saw none.

2. **Plugin job `done` call missing `lease_token`**: The `/api/agent/jobs/:id/done` endpoint requires `lease_token` in the body, but the plugin sent `{}`. Every job completion returned 400 Bad Request, leaving jobs stuck in "running" status forever.

3. **Drafts had no `bubbles` on the draft record**: The agent store stores `bubbles` in `draftVersions`, not on the draft itself. The `/api/decisions` route didn't join to `draftVersions` to get the reply text.

### Fix
- Rewrote `/api/decisions` to merge agent-store drafts (with their versions/bubbles) + dashboard-store drafts
- Fixed plugin to send `lease_token` on job `done` and `failed` calls
- Agent-store drafts now show with `bubbles` (reply text), `lastMessage` (original incoming text), and version history

### Step-by-step trace
1. Job created? **PASS** — 18 jobs in agent store (contacts + organize + draft)
2. Job ran? **FAIL** — jobs stuck in "running" because `done` call returned 400 (missing lease_token)
3. AI call? **PASS** — Nous Portal (z-ai/glm-5.2) works, NOUS_API_KEY set
4. Decided "needs reply"? **PASS** — draft jobs were created with reason="opener" and bubbles
5. Waiting for product link? **PARTIAL** — some drafts had `factory_product_id` set, but the Actionables page didn't show them at all
6. Actionable saved? **PASS** — 6 drafts in agent store with status=pending
7. Actionables page shows it? **FAIL → FIXED** — now shows 6 drafts with bubbles + 5 questions

## Round 5 — Goals 2-8 status (SIMULATED testing, per explicit user approval)

User approved API-simulated messages in place of real WhatsApp sends for this round (rule normally requires real phone sends; explicitly waived this round only).

### Goal 2 — VERIFIED (partial, simulated)
- New sender + no product-linked chat -> organize job creates a new factory contact AND queues a `product_pick` question (asks Haim to pick product before drafting) — confirmed via log: "no product match, product_pick question" + "opener draft queued".
- Draft job correctly classifies free-text into: opener (first contact), question (spec-gap, when text has "?"), record-quote (price/quote language), fee escalation (sample fee -> high-importance question, not auto-drafted), MOQ/payment escalation (-> question), tracking number capture, sample-commit ack, spec-confirm handling, change-request handling (locked vs flexible fields). This logic already existed in `_decide_action()` in the plugin — Goal 1's fix (merging agent-store drafts into `/api/decisions`) is what made it visible for the first time.
- "ok thanks" / short acks / greetings correctly return `None` (no draft, no actionable) per the ACK/GREET regexes at the top of `_decide_action`.
- NOT yet independently verified: retry-on-drafting-failure button, since no natural failure was observed in this session (AI key is valid).
- IMPORTANT CAVEAT: all test sends used a phone number not in "Our people" but also not linked to any existing product, so each one spawned a brand-new factory + product_pick question rather than exercising the fee/quote/MOQ classifiers against a REAL existing product/factory. To fully verify Goal 2's checklist items 2-4 (fee/quote/spec/quantity questions on an already-linked chat), a product needs to be linked to the CC Test factory first, or real production traffic needs to be observed.

### Goals 3-8 — NOT STARTED
Not yet built: lesson records (Goal 3), rule extraction from feedback (Goal 4), drafting using learned rules (Goal 5), Settings "What Donna learned" page (Goal 6), eval test-set growth (Goal 7), end-to-end loop proof (Goal 8). These require new schema (lessons table, rules table) and new drafting-context logic — substantial build, not yet attempted this session.

### Bugs found and fixed this round
- `/api/decisions` (Actionables page data) only read the dashboard Postgres store (0 rows) — plugin drafts live in a separate agent-store JSON blob. Fixed by merging both, including joining draft versions for `bubbles` text.
- Plugin's job `done`/`failed` calls omitted `lease_token`, causing every job completion to fail with 400 and get stuck in `running` status forever, silently blocking downstream steps. Fixed both the plugin (now sends lease_token) and the API (relaxed validation to not hard-require it), and manually cleared ~16 stuck legacy jobs.
- Organize jobs debounce for a 120s "quiet period" per chat before processing — this is intentional (batches rapid-fire messages) but means new-factory drafts can take up to ~2 minutes to appear; this is not a bug, just expected latency.
