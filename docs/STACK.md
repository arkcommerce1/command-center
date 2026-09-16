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

- **Anthropic-vs-Nous: UNRESOLVED, awaiting Haim.** SPEC §1.1 prescribes the
  Anthropic API for on-screen AI (`CC_MODEL`, default `claude-sonnet-5`), but
  the shipped code (`spec-ai`, `spec-ai-edit`) calls only the Nous Portal
  (`NOUS_API_KEY`, `z-ai/glm-5.3-flash`) — code comments cite "per Haim's
  instruction". Goal 1+ must not build on-screen AI until Haim picks a
  provider. No other decisions taken (Goal 0 changes nothing).
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
