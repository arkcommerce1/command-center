Command Center: Build Spec for Hermes
Owner: Haim Setton, Everlasting Ice Rx (haim@everlastingicerx.com)
Dashboard: https://command-center-review-tau.vercel.app
Spec version 5, September 15, 2026

How to use this file
You are Hermes. This file is the source of truth for building the Command Center. Save this file in the Command Center repo as docs/SPEC.md. Don't change it unless Haim tells you to. Put your own notes in docs/STACK.md. Work one goal at a time, in order. Haim starts each goal by pasting its /goal block (at the end of each goal). Never start work that belongs to a later goal. At the start of every goal, re-read §0 Rules, §1 Architecture, and that goal's section. §3 Reference holds the tables that goals point to. When unsure how Hermes works, check the docs at hermes-agent.nousresearch.com/docs (goals, skills, plugins, hooks, messaging/whatsapp, webhooks). When the docs and the Hermes source in your install disagree, trust the source and write down the difference in docs/STACK.md.

What the product does: AI agents work inside WhatsApp group chats and email threads with factories. The goal with each factory is to agree the spec and get a sample sent to our China office in Yiwu. Yuki in China checks each sample, then ships it to New York, where Haim approves or rejects it. Haim works only on the dashboard, and every message to a factory waits for his approval.

0. Rules
Copy this whole section into AGENTS.md in Goal 0.

0.1 Build rules
B1. Build only what this spec says. If something you need isn't here, stop and ask Haim. Never add a form, input field, setting, or confirmation step on your own.
B2. Keep the existing stack: framework, database, hosting, and auth if present. Add new dependencies only where §1 names them.
B3. Never touch Donna's live WhatsApp pairing, WhatsApp session folder, email credentials, or allowlists. Test messaging only in the CC Test WhatsApp group (Goal 2).
B4. Every goal adds tests. npm run check (typecheck, lint, unit tests, and e2e tests for finished goals) must pass before a goal is done. Run it yourself and include the last lines of output in your final message.
B5. Your final message for each goal lists every "Done when" line with its evidence: a passing test name, a file path, a log line, or a screenshot path. The goal judge reads only that message.
B6. Secrets live in environment variables and are never committed. Never sign up for or pay for a service. Ask Haim for keys.
B7. Database migrations only add. Never delete Haim's data.
B8. Record every technical decision in docs/STACK.md under "Decisions".

0.2 Product rules
Enforce these in server code, not only in prompts.
P1. No message goes into a chat that has a factory contact in it unless Haim approved that exact version. The server checks a content hash at send time. This includes openers, follow-ups, second and third tries, and the "@Yuki can you pay" message.
P2. Agents may send automatically only to chats where every member is an Ours contact: Haim's DM, Yuki's DM, and internal groups.
P3. Agents never negotiate. No prices, counteroffers, discounts, minimum orders, payment terms, volumes, or order commitments. Quotes are recorded for Haim only. The guardrail in §3.4 enforces this.
P4. Agents may name our brands (AllSett Health, Refreshify, Everlasting) and say we already import and sell. They never state volumes unless Haim turned on "Can share volumes" for that factory.
P5. Messages we send are English only. Messages we receive in another language are stored with an English translation.
P6. Agents ask for a sample only after step 3 (Spec agreed) is done for that factory and product.
P7. Sample fees always go to Haim as a decision. Agents never agree to a fee or argue about it.
P8. Never pushy. Follow-up timing follows §3.6. Agents don't push factories on which day they ship.
P9. No manual data entry. Agents fill in data from chats, email, the Amazon listing, and the approved spec. Haim can edit anything.
P10. Automatic actions that don't send a factory message are logged in the activity log with Undo. This covers creating contacts, marking steps, merging contacts, and archiving.
P11. Each factory and product pair is tracked on its own. A factory working on 3 products has 3 rows and gets 3 separate drafts.

1. Architecture

1.1 The pieces
Factory WhatsApp groups, Factory email, Yuki on WhatsApp -> Donna (Hermes gateway + command_center plugin + cc-* skills) <-HTTPS+token-> Dashboard (existing web app: pages + Agent API + database, approvals, versions, guardrail) -> Haim's WhatsApp DM (short notices); Haim approves on the dashboard.

Piece | Job | Technology
Dashboard | Every page Haim uses. The only place data is stored. Owns every hard rule: approvals, versions, guardrail, send gate, Undo. | The existing app on Vercel. Keep its framework and database. If it has no database, use Postgres on Neon with Drizzle ORM.
Agent API | The only way Donna reads or writes Command Center data. | Route handlers under /api/agent/*. Bearer token CC_AGENT_TOKEN. Every request body is validated with zod.
Donna | Hermes gateway already connected to WhatsApp and email. Receives messages, runs the agents, sends approved messages. | The existing Hermes install, plus the command_center plugin (§1.4) and the cc-* skills (§1.5).
On-screen AI | Work Haim waits for on screen: rewriting a draft after Suggest changes, AI Spec Draft, and the spec edit bar. | Anthropic API called from the dashboard server. Model from env CC_MODEL, default claude-sonnet-5. Prompts load the same reference files as the skills, so there is one copy of the style guide.
Tracking | Carrier status for every sample shipment. | 17TRACK API, which detects carriers automatically (SF Express, UPS, FedEx, USPS, DHL). Webhook at /api/webhooks/17track, plus a refresh on each tick as a fallback. Key in CC_17TRACK_KEY.
PDF | The spec sheet PDF. | react-pdf/renderer, generated on the server.
Login | Protects every page and every API except the Agent API and webhooks. | Keep existing auth if there is one. Otherwise Auth.js with Google sign-in, limited to the emails in CC_ALLOWED_EMAILS.
Live updates | Pages reflect new drafts and statuses without a reload. | The database's realtime feature if it has one. Otherwise poll every 10 seconds with SWR.

Where AI runs: If Haim is waiting on screen, it runs in the dashboard through the Anthropic API. If a message or the clock triggered it, it runs in Donna (Hermes).

1.2 Data model
Add these tables. Follow the repo's naming conventions, but keep the meaning of each field.

Table | Key fields
products (existing) | add approach (already_selling by default, or fresh), amazon_snapshot (JSON: title, bullets, description, image URLs, fetched_at)
spec_versions | product_id, version, fields (JSON list of key, label, value, tag locked or flexible, status filled or needs_input), status draft or approved, created_by ai or haim
factories | name, company_name, can_share_volumes (default false), archived_at
factory_products | factory_id, product_id, unique on the pair. step1 to step5 each with proof_message_id and done_at. status_sentence, waiting_on (haim, factory, yuki, carrier, none), waiting_since, next_step, product_guessed, followups_unanswered, archived_at
adjustments | factory_product_id, field_key, proposed_value, message_id, result (accepted, declined, pending)
contacts | name, type ours or factory, factory_id, role (sales_agent, designer, logistics, owner_manager, qc, other), role_note, role_source default or self_stated, role_proof_message_id, description, created_by agent or haim
contact_channels | contact_id, kind (whatsapp, email, wechat), value, unique on kind and value
chats | channel whatsapp or email, external_id (unique), name, kind (group, dm, email_thread), factory_id, has_factory_members (derived from members)
chat_members | chat_id, contact_id
messages | chat_id, contact_id, direction in or out, external_id (unique), text, translation, lang, media (JSON), sent_at, factory_product_id, from_outbox_id
drafts | factory_product_id, chat_id, kind (reply, opener, followup, fee_pay, sample_change, decline), reason, status (pending, approved, disapproved, closed), closed_reason, current_version. Partial unique index: one pending draft per factory_product_id
draft_versions | draft_id, version, bubbles (JSON list of strings), content_hash, source (ai, suggestion, update), suggestion_text, guardrail (JSON), created_at
outbox | draft_version_id (unique), chat_id, bubbles, status (queued, sending, sent, failed, uncertain), send_after, lease_token, lease_expires_at, attempts, external_message_ids, error
questions | factory_product_id, kind (question, fee, product_pick, sample_flag, sample_review, send_uncertain, guardrail_block), body (JSON), status open or answered, answer (JSON), importance
quotes | factory_product_id, message_id, text. Haim only
open_items | factory_product_id, direction we_owe or they_owe, kind question or sample_tracking, summary, opened_message_id, opened_at, followups_sent, resolved_at
samples | factory_product_id, stage (§3.5), qc_result (pass, problem), qc_notes, photos (JSON), haim_result (approved, rejected, change_requested)
shipments | leg china_to_yiwu or yiwu_to_ny, tracking_number, carrier, status, last_event, eta, events (JSON)
shipment_items | shipment_id, sample_id
notifications | contact_id, chat_id, text, attachments, status, sent_at. Donna to Ours contacts only, sent automatically
activity_log | actor agent or haim, action, entity, entity_id, before, after, undoable, undone_at
agent_jobs | type, payload, status (queued, running, done, failed), lease_token, lease_expires_at, attempts, error
settings | yiwu_address (seed below), our_brands

Seed settings.yiwu_address with the address from Haim's chats: 浙江义乌稠城街道丹溪北路18号雪峰银座9楼912室 丁小姐 15067460724.

1.3 Agent API
Every endpoint needs Authorization: Bearer CC_AGENT_TOKEN.

Endpoint | Purpose
POST /api/agent/ingest | Store one inbound or outbound message with media. Creates or updates the chat and its members, then queues jobs (contacts, organize). Idempotent on external_id.
POST /api/agent/jobs/claim, POST /api/agent/jobs/:id/done, .../failed | Job queue with a 5-minute lease.
POST /api/agent/tick | Called every 15 minutes by the plugin. Runs time-based checks (§3.6) and tracking refresh, and queues jobs. Never calls an LLM.
GET /api/agent/context?factoryProductId= | Everything a drafter needs in one response (§3.2).
POST /api/agent/contacts, PATCH /api/agent/contacts/:id, POST /api/agent/contacts/merge | Contacts agent writes.
POST /api/agent/messages/:id/annotate | Product link, translation, language.
POST /api/agent/steps | Mark a step done with its proof message.
POST /api/agent/status | Status sentence, waiting on, next step, note.
POST /api/agent/drafts | Create a draft, or a new version of the pending one. Runs the guardrail first.
POST /api/agent/questions, /quotes, /adjustments, /open-items, /open-items/:id/resolve | Organizer writes.
POST /api/agent/samples, /shipments, /shipments/:id/items, /samples/:id/qc | Sample flow.
POST /api/agent/notifications | Queue a message to an Ours contact.
POST /api/agent/outbox/claim, /outbox/:id/sent, /outbox/:id/failed, /notifications/claim | Sending.
POST /api/agent/approval-reply | Haim's WhatsApp codes (Goal 7).
GET /api/agent/spec/:productId/pdf | Spec PDF for attachments.

What the server guarantees:
Approve runs in one database transaction. The version must be the latest, the draft must be pending, and the content hash must match. Only then does it create one outbox row.
Outbox claim uses a lease, so a row reaches sent only once. If a send started and its result is unknown, the status becomes uncertain and a card asks Haim to check the chat. Rows marked uncertain are never resent automatically.
Guardrail: POST /drafts runs the guardrail (§3.4) before saving. A blocked draft becomes a guardrail_block question, not a draft.
Step proof: POST /steps rejects any proof message that isn't an inbound message from a factory contact in that chat, or that only acknowledges (§3.3).
Human reply closes the draft: an outbound message from an Ours contact that didn't come from the outbox closes that chat's pending draft, with closed_reason human_replied.
Updated drafts: when a new factory message arrives while a draft is pending, the drafter adds a new version marked update. Only the newest version can be approved.

1.4 The command_center Hermes plugin
Location: hermes/plugins/command_center/ in the repo, installed into Hermes the way the plugin guide describes. Before writing any code, read the Hermes plugin guide and the hooks page, and confirm each API below in the Hermes source. Record what you confirmed, with source file paths, in docs/STACK.md.

The plugin does six things.
1. Silent ingest. Register pre_gateway_dispatch. For every inbound WhatsApp or email event that isn't Haim talking to Donna in his DM: POST it to /api/agent/ingest, with media. Return {"action": "skip"}. This way no Hermes agent session is ever attached to a factory chat, so nothing can be auto-replied there. Also ingest Donna's own outbound messages and messages Haim or Yuki type directly in groups. Haim's DM with Donna keeps working as it does today, except for approval codes (Goal 7).
2. Job runner. A background thread polls /api/agent/jobs/claim every 5 seconds, with no LLM call when the queue is empty. For each job, start one isolated agent run that loads only that job type's skill (§1.5) and the cc_* tools. No messaging tools, no terminal. Start runs the officially documented way: the webhook platform on localhost, or the plugin API if it offers one. Run at most 3 at once. A job starts within 60 seconds of being queued. Batch organizer jobs per chat: wait until the chat has been quiet for 2 minutes.
3. Outbox sender. A background thread polls /api/agent/outbox/claim and /api/agent/notifications/claim every 10 seconds. Send each row's bubbles in order, 2 to 4 seconds apart, through Donna's WhatsApp adapter (or her email adapter for email chats). Report sent with the message IDs, or failed. Attach PDFs as WhatsApp documents.
4. Tick. Every 15 minutes, POST /api/agent/tick.
5. Send block. Register pre_tool_call. Block any messaging tool call (for example send_message) whose target chat has a factory member, and fail closed.
6. Tools and rules. Register cc_* tools that wrap the Agent API one-to-one. The tools don't enforce rules; the API does. Register §0.2 as a system prompt section with register_system_prompt_section (4,000 characters or less), so every Donna run carries the product rules.

Hermes config for Donna's profile (~/.hermes/config.yaml), merged with what's already there:
skills:
  external_dirs:
    - <absolute path to repo>/hermes/skills   # cc-* skills live in git
  write_approval: true    # self-improvement can't silently rewrite cc-* skills
memory:
  write_approval: true
whatsapp:
  reply_prefix: ""        # no "Hermes Agent" header on messages factories see
  send_read_receipts: false
goals:
  max_turns: 40

Don't store business data in Hermes memory. The database is the memory. Style learning comes from draft_versions: Haim's suggestions and the rewrites he approved.

1.5 Agents and skills
Each agent is a skill at hermes/skills/<name>/SKILL.md, written in the Hermes format:
Frontmatter: name, description of 60 characters or less, version, and metadata.hermes tags and category.
Sections: When to Use, Procedure, Pitfalls, Verification.
Donna, the orchestrator, is the plugin's job router: it maps each job type to one skill. Sub-agents have no names, and each has one fixed job.

Agent | Skill | Triggered by | Writes
Contacts | cc-contacts | Unknown sender, new group member, new email sender | contacts, channels, merges
Organizer (sub-agent 2) | cc-organizer | New messages in a chat (batched) | product link, translation, steps, status, notes, quotes, adjustments, open items, tracking numbers, fee and product-pick questions, new factory setup. Queues a draft job when a reply is needed
Reply drafter (sub-agent 1) | cc-reply-drafter, with references/style-guide.md (§3.7), references/reply-table.md (§3.8), references/examples.md | Organizer, answered question, follow-up due | drafts and versions
Spec (sub-agent 3) | cc-spec, with templates/spec-template.md (§3.9) | Product added, or snapshot missing | amazon_snapshot. The on-screen draft itself runs in the dashboard with the same template
Yuki (sub-agent 4) | cc-yuki | Send Yuki Brief, sample arrived in Yiwu, Yuki's replies, box tracking number | notifications to Yuki, QC results, photos, shipments, box contents
Follow-up (sub-agent 5) | cc-followups | Tick finds an overdue open item | importance, follow-up draft, notice to Haim

Why this shape: one skill per job keeps each run small and testable, and all hard rules live in the API, so a confused run can't break them.

1.6 Pages
Navigation, in this order: Actionables, Products, Factories, Samples (with China and New York tabs), Contacts.
Remove "Tonight" and redirect /dashboard/tonight to Actionables.

2. Goals

Goal 0: Audit and setup
Objective: Know exactly what exists before changing anything. No product changes in this goal.
Build:
- Save this spec as docs/SPEC.md.
- Run /init to create or update AGENTS.md, then add §0 to it word for word.
- Write docs/STACK.md with these sections: framework, hosting, database and ORM, auth env var names; how pages load data; where any existing AI or agent code lives; how Donna runs: Hermes profile, platforms, config paths, WhatsApp mode, Hermes version; whether each plugin API in §1.4 exists, with source paths.
- Under "Current state" in docs/STACK.md, list every page and button as working or broken. Include at least: Tonight, Products, product detail, Contacts, FBA calculator button, AI Spec Draft, Copy Yuki Brief, spec PDF, Star, Build spec sheet, Source factories. Also say what the FBA calculator computes and whether it saves results.
- Set up npm run check (typecheck, lint, Vitest, Playwright) with a seeded test database. Reuse the repo's tools if present.
Done when: docs/SPEC.md, AGENTS.md (containing §0), and docs/STACK.md exist, with every section above filled in. npm run check passes on the unchanged app, including an e2e smoke test that opens every page.
/goal Complete Goal 0 (Audit and setup) in docs/SPEC.md exactly as written. Re-read §0 and §1 first.

Goal 1: Foundation
Objective: Login, data model, Agent API, approval engine, guardrail, and Undo, all tested before any agent touches real chats.
Build:
- Login on all pages and non-agent APIs (§1.1).
- Every table in §1.2 as additive migrations, plus the settings seed.
- The Agent API in §1.3, with token auth, zod validation, and all the server guarantees.
- An approval engine module used by both the Agent API and the dashboard: approve, suggest (new version), disapprove, close on human reply, update on new message, latest-only, one pending per factory and product, hash check, outbox lease, uncertain.
- A guardrail module (§3.4).
- A China business-time module (§3.6) with a holiday table for 2026 and 2027 checked into the repo.
- Activity log, plus one Undo endpoint that reverses any undoable entry.
Done when: Opening any dashboard page while logged out redirects to login, and an Agent API call without the token returns 401 (e2e tests). Unit tests pass for: every approval engine transition; approving an old version is refused; a hash mismatch is refused; a second pending draft for the same factory and product is refused; two concurrent outbox claims give one winner. Guardrail unit tests pass for every pattern in §3.4, including the allowed exceptions. Business-time unit tests pass for a weekend, Golden Week (Oct 1 to 7), and a Friday-to-Monday case. Undo restores the "before" state for a contact creation and a step mark (unit tests).
/goal Complete Goal 1 (Foundation) in docs/SPEC.md exactly as written. Re-read §0, §1.1 to §1.3 and §3.3 to §3.6 first.

Goal 2: Donna's plugin
Objective: Donna stores every message, runs agent jobs, and sends only approved messages, with nothing auto-replied in factory chats.
Needs from Haim: a WhatsApp group named CC Test with Donna, Haim, and one other phone acting as a factory. Stop and ask if it doesn't exist.
Build:
- The plugin in §1.4, all six parts.
- The config changes in §1.4.
- A cc-echo test skill that writes a note through cc_status, used only to prove the job runner.
- Turn ingest on for CC Test only first, behind env CC_INGEST_CHATS=allowlist. Switch to all chats (CC_INGEST_CHATS=all) only after every Done-when line passes, and only when Haim says so.
Done when: A message from the test "factory" phone in CC Test appears in messages within 30 seconds, and Donna posts nothing in the group. Verify with the chat's message list and the gateway log. Haim's DM with Donna still gets normal replies. A test draft approved through the API is sent exactly once: bubbles arrive in order, with no header prefix; if the gateway restarts while that row is sending, the row ends uncertain and isn't resent. A forced messaging tool call to CC Test from a Donna run is blocked (log line). A queued cc-echo job starts within 60 seconds, and its run log shows only that skill and the cc_* tools. With an empty queue for 10 minutes, there are zero LLM calls (usage log).
/goal Complete Goal 2 (Donna's plugin) in docs/SPEC.md exactly as written. Re-read §0, §1.3 and §1.4 first.

Goal 3: Contacts agent and Contacts page
Objective: Every person Donna talks to, on WhatsApp or email, is a contact linked to the right factory. Every agent checks contacts before writing.
Build:
- The cc-contacts skill.
- Seed the Ours contacts: Haim: haim@everlastingicerx.com, plus his WhatsApp number from Donna's config; Donna: her WhatsApp number; Yuki: found from chats. If Yuki's number can't be found with certainty, ask Haim once.
- New person in a group: when a new person sends a message in a group, create a contact right away: linked to that group's factory, type factory, role Sales agent, role_source default, a one-line description: what they handle, company, how they write. A factory can have many contacts.
- Roles: the role changes only when the person states their own role, for example "Hi, I'm Ali, the logistics manager." Then set role and role_note, set role_source to self_stated, and link the proof message. Other people describing them doesn't change the role.
- Email matching: Match the sender by email channel first. Otherwise match by domain, company name, or signature to a factory. When confident, add the channel to the existing contact or create a contact. When not confident, put the sender in an "Unmatched" list on the Contacts page. No drafts for unmatched senders.
- Merging: when the same person appears on WhatsApp and email (a phone number or email in a signature matches), merge them automatically. Everything above is automatic and logged with Undo.
- Contacts page: Columns: Name, Company, Ours/Factory, Role, Description, Channels, Groups, Last message. Any cell is editable inline, and Haim's edits are marked created_by haim so agents don't overwrite them.
Done when: Fixture test: a new sender in a test group gets a contact with role Sales agent within 60 seconds. Fixture test: "I'm Ali, the logistics manager" sets role Logistics with the proof message linked. Fixture test: "Ali handles logistics" said by someone else doesn't change Ali's role. Fixture test: an email from a known contact's address attaches to that contact; an unknown sender with no match lands in Unmatched. Undo on an automatic contact creation removes the contact (e2e). The Contacts page shows the 8 columns and saves inline edits (e2e).
/goal Complete Goal 3 (Contacts agent and Contacts page) in docs/SPEC.md exactly as written. Re-read §0 and §1.5 first.

Goal 4: Product page and Products list
Objective: Each product shows a clear ladder of where it stands, and every button works.
Build:
- Delete the "Yuki brief checklist" section with its fields and code.
- Add the stage ladder (§3.1) at the top of the product page, replacing the loose buttons: each stage shows done, current, or not started, and holds that stage's action. The current stage is the first one not done. Star stays where it is.
- FBA calculator: the button opens that product's working calculator; it must not just scroll. Stage 2 is done when the calculator has a saved result.
- Send Yuki Brief replaces Copy Yuki Brief: one click queues a notification, and Donna sends Yuki the product name and the spec PDF on WhatsApp (automatic, since Yuki is Ours). Disabled until the spec is approved. After sending, shows "Sent to Yuki" with the time.
- Spec PDF: generate it from the latest approved spec, with product name, main image, and every field. This fixes the empty PDF.
- Loading states: skeleton rows while loading. Show an empty state only after data has loaded and is empty. If a request fails, show an error with Retry instead of an endless "Loading…".
- Move pipeline ideas off the Tonight page into an Ideas section on the Products page.
- Add a "Factories" section on the product page listing its factory rows, linked to Goal 6 pages (links can come later).
Done when: The checklist is gone (e2e checks its heading is absent). The ladder renders all 8 stages with correct done/current states for seeded data (e2e). The FBA calculator button opens the calculator (e2e). Send Yuki Brief is disabled without an approved spec. With one, it creates a notification row with the PDF attached (e2e plus API test). The generated PDF contains every approved spec field (unit test reads the PDF text). The Products list shows skeleton rows, not "No products yet.", while the request is pending (e2e with a delayed response).
/goal Complete Goal 4 (Product page and Products list) in docs/SPEC.md exactly as written. Re-read §0 and §3.1 first.

Goal 5: AI Spec Draft
Objective: One click turns the Amazon listing into a spec sheet that Haim approves and can always edit.
Build:
- Amazon snapshot: when a product is added, or its snapshot is missing, queue a cc-spec job. Donna reads the Amazon listing with the Hermes browser tool and saves amazon_snapshot: title, bullets, description, and image URLs. While that runs, the AI Spec Draft button shows "Reading Amazon listing…".
- AI Spec Draft runs in the dashboard through the Anthropic API. Input: the snapshot text, the main image, and the template (§3.9). Output: fields in the template's format. Any field the model isn't sure about is left out of the value and shown as "Needs input". The model also suggests a Locked or Flexible tag per field.
- Approve saves the draft as an approved spec_version.
- Editing: the spec is always editable inline, and every save creates a new version with visible history. Tags can be switched with one click.
- AI edit bar under the spec: Haim types a change such as "make it 80% cotton", sees the proposed change highlighted, and chooses Accept or Reject.
- Fields marked "Needs input" appear on ladder stage 1 as "N fields need input". No separate card.
Done when: With a stubbed AI response, the draft renders in template order and skipped fields show "Needs input" (e2e). Approve creates version 1 as approved. An inline edit creates version 2 (e2e). The edit bar shows a highlighted proposed change. Accept creates a new version; Reject creates none (e2e). A live smoke test on one real product produces a spec with no invented certificate field (log excerpt in the final message).
/goal Complete Goal 5 (AI Spec Draft) in docs/SPEC.md exactly as written. Re-read §0, §1.1 and §3.9 first.

Goal 6: Factories, factory summary, and the organizer
Objective: Clicking any factory shows where we're holding with it, and all of it is filled in automatically from the chats.
Build:
- The cc-organizer skill. For each batch of new messages in a chat: link each message to one product (a group about one product links directly; in a multi-product group, pick the product the message is about; if ambiguous, use the most recently active product and set product_guessed); translate non-English messages; mark steps with proof, following §3.3; update the status sentence, waiting on, waiting since, and next step; record quotes (shown to Haim only); record proposed spec changes as adjustments; open and resolve open items (§3.6); pull out tracking numbers and create the China shipment and sample (Goal 10 builds the tabs, but store the data now); when a factory asks for a sample fee, create a fee question (§3.8); decide whether a reply is needed per §3.8, and if so queue a draft job.
- New group setup: when Donna is added to a new group that has non-Ours members: create the factory, named from the group name or the company in messages; create the factory_product; if no product matches, create a product_pick question; queue an opener draft job.
- Factories page: one row per factory and product, with columns: Steps (5 dots; a done dot links to its proof message), Status sentence, Waiting on, Since (hours or days), Next step, a "guessed product" badge when set. Rows waiting on Haim come first, then the longest waiting. Filter by product. Archived rows are hidden behind a "Show archived" toggle.
- Factory summary page (click a row). Top block, "Where we stand": one-paragraph summary, the 5 steps with proof links, waiting on and since, next step, open items. If the factory works on several products, repeat that block per product. Below the top block: proposed changes; what we've told this factory (facts pulled from our outbound messages); quotes, for Haim only; samples for this factory, with both shipping legs; contacts; a timeline of translated messages and activity; the "Can share volumes" toggle.
Done when: Fixture chats in tests/fixtures/organizer/ each produce the expected steps, waiting on, and next step. A thumbs-up or "ok" never marks a step (tests). A multi-product fixture links messages to the right products and sets product_guessed on the ambiguous one (test). A new-group fixture creates a factory, a factory_product or product_pick question, and an opener job (test). The Factories page sorts Haim-waiting rows first. The summary page shows every block listed above for seeded data (e2e).
/goal Complete Goal 6 (Factories, factory summary, organizer) in docs/SPEC.md exactly as written. Re-read §0, §1.5, §3.3, §3.6 and §3.8 first.

Goal 7: Actionables and approvals
Objective: Haim makes every decision from one page, without opening WhatsApp. WhatsApp is an optional shortcut.
Build:
- The page. Actionables shows decisions only. Nothing else goes on this page. A counter at the top, e.g. "4 to approve, 2 questions, 1 sample". Order: High importance first, then oldest. When empty, it says "Nothing needs you right now."
- Card types: Message to approve (factory, product, step, why, factory's last message translated, the draft bubbles; buttons: Approve, Suggest changes, Disapprove; follow-up drafts also have Send now/Tomorrow 9:30 China time/In 3 days); Question from factory (the question translated, an answer box; Save answer routes to the spec field the AI proposes or product notes, then queues a draft job); Sample fee (amount, currency, what it covers, the factory's message, and the exact message that will be posted; buttons: Approve fee, Don't pay, Suggest changes); Which product? (new group's name and first messages; one button per likely product); Draft touched a blocked topic (factory message and blocked draft; answer box goes to the drafter); Couldn't confirm a send (message and chat; Mark as sent, Send again); Yuki flagged a sample / Sample arrived in New York (built in Goal 10).
- Suggest changes: Haim types what he wants. The dashboard rewrites the draft with the Anthropic API, using the style guide, the drafter context, and his suggestion. The new version shows word-level highlights of what changed. The buttons appear again. Only the latest version's buttons work. A Disapprove reason is optional and one line; it's saved as a style example.
- WhatsApp shortcut: for each new card, Donna sends Haim one DM with a one-line summary, a code like D14.2 (draft 14, version 2), and the dashboard link. Haim can reply: Y14.2 to approve, N14.2 to disapprove, S14 <text> to suggest changes. The plugin sends these replies to /api/agent/approval-reply and doesn't pass them to the agent. A reply to an old version gets "There's a newer version (v3). Check the dashboard." Dashboard and WhatsApp always show the same state.
Done when: E2e tests cover each card type: Approve creates exactly one outbox row, Suggest creates v2 with highlights and disables v1's buttons, and Disapprove closes the draft. E2e test: approving on the dashboard, then replying Y14.1 on WhatsApp, sends nothing twice and returns the "newer version" or "already approved" reply. E2e test: approving a fee card queues exactly the shown "@Yuki" message. The page contains no pipeline ideas section (e2e). A real approval in CC Test sends one message (message ID in the final message).
/goal Complete Goal 7 (Actionables and approvals) in docs/SPEC.md exactly as written. Re-read §0, §1.3 and §3.7 first.

Goal 8: Reply drafter
Objective: Drafts are accurate, sound like Haim, and move each factory toward a sample without negotiating.
Build:
- The cc-reply-drafter skill. It reads its context through cc_get_context (§3.2) and follows the style guide (§3.7) and the reply table (§3.8). It writes bubbles, not one long block.
- Openers for new groups use the product's approach (§3.7) and attach the spec PDF as a document.
- Updates: when a new factory message arrives while a draft is pending, write a new version marked update.
- references/examples.md: build it from Haim's own past outbound messages in synced factory chats, plus pairs of Haim's suggestions and the rewrites he approved. A weekly job refreshes it. It's generated data in the repo; it isn't edited by self-improvement.
- Eval set: npm run eval:drafter runs at least 25 recorded scenarios in tests/fixtures/drafter/. Each scenario has the expected action from §3.8 (no draft, draft, question card, fee card).
Done when: npm run eval:drafter: 90% or more of scenarios get the expected action; 100% of saved drafts pass the guardrail; 0 sample requests before step 3; 0 non-English drafts. A scenario where the factory quotes a price records the quote and produces a draft with no numbers (test). An opener draft in CC Test, once approved, arrives with the PDF attached (message ID in the final message).
/goal Complete Goal 8 (Reply drafter) in docs/SPEC.md exactly as written. Re-read §0, §3.2, §3.4, §3.7 and §3.8 first.

Goal 9: Follow-ups
Objective: Nothing goes quiet without Haim knowing, and follow-ups never feel pushy.
Build:
- On each tick, check open items against §3.6. For an overdue they_owe item, queue a cc-followups job, which: rates importance (High if it blocks a sample, Medium if the factory was active in the last 7 days, Low otherwise); creates a follow-up draft with the send-timing buttons from Goal 7; sends Haim the WhatsApp notice.
- For an overdue we_owe item (a factory question waiting on Haim), raise that question card to High and notify Haim. No factory draft.
- After 2 follow-ups go unanswered for the same factory and product: archive that row automatically, log it with Undo, notify Haim.
- Follow-up sends never go out outside China business hours; send_after moves to the next 9:30 China time. A they_owe question becomes due after 24 hours on China business days, so Friday 5pm becomes due Monday 5pm. Nothing becomes due during Golden Week. A sample_tracking item becomes due after 3 China business days. A we_owe item raises its card to High and creates no factory draft. The second unanswered follow-up archives the row, and Undo restores it.
Done when: (see business rules above, verified by tests per §3.6)
/goal Complete Goal 9 (Follow-ups) in docs/SPEC.md exactly as written. Re-read §0 and §3.6 first.

Goal 10: Samples, China and New York
Objective: Every sample can be followed from the factory to Yiwu, through Yuki's check, to New York and Haim's decision, without anyone typing anything.
Build:
- A Samples page with China and New York tabs. Each factory summary page also shows its samples. Stages follow §3.5.
- China tab: one row per sample, showing factory, product, China tracking number and carrier status, arrival date, Yuki's check (waiting, pass, problem), and photos.
- China flow: a factory tracking number creates a china_to_yiwu shipment registered with 17TRACK. When it's delivered, or Yuki posts photos first, Donna messages Yuki (automatic) with which sample it is, the locked spec fields, and a request for photos and "pass" or what's wrong. The cc-yuki skill reads Yuki's reply. Pass: sample moves to "Ready to ship". Problem: a "Yuki flagged a problem" card goes to Actionables with Yuki's photos, her notes, the locked spec fields, and a draft message to the factory. Buttons: Approve message, Suggest changes, Ship to New York anyway, Reject sample.
- New York tab: a "Ready to ship from Yiwu" list. Boxes, each with tracking number, carrier, status, ETA, and a contents list.
- New York flow: when Yuki posts a tracking number, Donna asks her which samples are inside, suggesting the Ready to ship list. When Yuki confirms, create the yiwu_to_ny shipment and its items. When the box is delivered, each sample in it gets a "Sample arrived in New York" card on Actionables and a row on the tab, showing Yiwu photos, the spec, and the Amazon image. Buttons: Approve quality, Reject, Suggest a change. Suggest a change creates a draft message to that factory, which needs approval.
- Tracking: 17TRACK webhook (verify its signature), plus refresh on tick. Show carrier name, last event, and ETA.
Done when: With stubbed 17TRACK webhooks, a sample moves through every §3.5 stage in order (integration test). Fixture tests: Yuki's "pass" moves the sample to Ready to ship; a problem reply creates the flagged card with a factory draft. A box confirmation creates a shipment with the right contents, and delivery creates one New York card per sample (test). Suggest a change on a New York card creates a draft for that factory that needs approval (e2e). Both tabs and the factory page sample section render seeded data (e2e).
/goal Complete Goal 10 (Samples, China and New York) in docs/SPEC.md exactly as written. Re-read §0, §1.1 and §3.5 first.

3. Reference

3.1 Product stage ladder
Stage | Done when | Action shown
1. Spec approved | An approved spec version exists | AI Spec Draft, or Edit spec. Shows "N fields need input"
2. FBA numbers saved | The FBA calculator has a saved result | Open FBA calculator
3. Factories contacted | At least 1 factory row has step 1 done. Shows the count | Factories for this product
4. Spec agreed with a factory | At least 1 row has step 3 done | Open that factory
5. Sample committed | At least 1 row has step 4 done | Open that factory
6. Passed China check | At least 1 sample passed Yuki's check | Samples, China tab
7. Arrived in New York | At least 1 sample reached New York | Samples, New York tab
8. Sample approved | At least 1 sample approved by Haim | Open sample

3.2 Drafter context (GET /api/agent/context)
Returns all of the following in one response: the product and its approach; the latest approved spec with tags; adjustments for this factory; what we've already told this factory; current step and step proofs; open items; the pending draft and its versions; the last 30 messages, translated, plus a summary of older ones; the factory's contacts and roles; can_share_volumes; the Yiwu address; the 20 most recent style examples.

3.3 Factory steps
Step | Done when a factory contact's message shows
1. Contact | A real reply about the product. A greeting doesn't count.
2. Can you make it | They confirm they can make it.
3. Spec agreed | They confirm the spec, and no questions or proposed changes are still open.
4. Sample committed | They confirm they'll send the sample.
5. Shipped | A tracking number.
How steps work: Steps can complete in any order. The current step is the first one not done. A proof message never counts if it only acknowledges. Examples: ok, okay, noted, received, thanks, got it, please wait, one moment, a single emoji or thumbs-up, 好的, 收到, 稍等.

3.4 Guardrail
The guardrail runs on every draft before it's saved. Matching is case-insensitive. Block a draft if it contains any of these:
Currency: a number next to $, US$, USD, ¥, RMB, CNY, yuan, dollar, dollars, or €.
Pricing: price, pricing, cost, cheaper, discount, counter, counteroffer, target price, budget, per unit, per piece, /pc, /pcs, unit price, EXW, FOB, CIF, DDP.
Orders: MOQ, minimum order, order quantity, bulk order, first order, trial order, container, 20GP, 40HQ.
Payment: payment terms, deposit, T/T, TT payment, balance payment, L/C, wire transfer, invoice, PayPal, Alipay.
Volume (only when can_share_volumes is false): per month, monthly, per year, annually, kg/month, pcs/month, units/month, tons.
Always allowed: numbers that appear in the approved spec (dimensions, weights, percentages); dates, tracking numbers, the Yiwu address, phone numbers; the exact fee card message.
A blocked draft becomes a "Draft touched a blocked topic" card. It's never saved as a draft.

3.5 Sample stages
Stage | How it moves to the next
1. Waiting for tracking | Factory committed. Next: a tracking number in chat
2. On the way to Yiwu | 17TRACK in transit. Next: delivered
3. In Yiwu, waiting for Yuki | Donna asked Yuki. Next: Yuki replies pass or problem
4. Problem flagged | Haim's card. Next: Ship anyway (to 5), Reject (ends), or a message to the factory (a new sample returns to 1)
5. Ready to ship | Yuki passed it. Next: included in a confirmed box
6. On the way to New York | 17TRACK in transit. Next: delivered
7. In New York, waiting for Haim | Card on Actionables. Next: Haim's decision
8. Approved, Rejected, or Change requested | Final. Change requested also creates a factory draft

3.6 Follow-up timing
Clock: China Standard Time (UTC+8). Business days: Monday to Friday, excluding Chinese public holidays in the holiday table.
They owe us an answer: due 24 business-day hours after our question.
Sample tracking: the factory committed a sample but sent no tracking number. Due after 3 business days. The follow-up asks gently for an update and never names a ship day.
We owe them an answer: after 24 business-day hours, raise the question card to High and notify Haim. No factory draft.
Sending: follow-ups go out only between 9:30 and 18:00 China time on business days.
Archiving: after 2 unanswered follow-ups for the same factory and product, archive the row with Undo.

3.7 Style guide
These are references/style-guide.md; the dashboard's rewrite prompt loads the same file.
How to write: English only. Short lines. Use 1 to 4 short bubbles instead of one long paragraph. Warm but direct. No filler like "I hope this message finds you well". Give the reason when asking for something, for example "so we can compare it with our current product". Treat sending a sample as the normal next step. Nudge with a polite @mention of the sales contact. Never pushy about timing. Never mention prices, costs, or volumes. Match what we've already told this factory, and never contradict it. Speak as "we". No sign-off on WhatsApp. On email, sign off with "Haim".
Approach, set per product: Already selling (default): we already import and sell this kind of product under AllSett Health, Refreshify, and Everlasting, and we're adding another factory. Fresh: no brands and no mention of existing sales.

3.8 Reply table
Factory message | What the agents do
Greeting, "ok", "please wait", thumbs-up | Nothing. Log only
A question the approved spec answers | Draft the answer from the spec
A question the spec doesn't answer | Question card for Haim. After he answers, draft the reply
Proposes a change to a flexible field | Record the adjustment as accepted and draft an acceptance
Proposes a change to a locked field | Draft a polite decline explaining it must match. Haim can suggest "accept it"
Quotes a price | Record the quote for Haim. Draft a short thanks that returns to the spec or sample, with no numbers
Asks about minimum order, volume, payment terms, or order size | Question card for Haim
Asks for a sample fee | Fee card for Haim
Confirms they can make it | Mark step 2. If spec questions are open, draft them; otherwise draft a spec confirmation request
Confirms the spec | Mark step 3. Draft the sample request with the Yiwu address
Commits to a sample | Mark step 4. Draft thanks. Open a sample_tracking item
Sends a tracking number | Mark step 5. Draft thanks. Create the China shipment
Donna added to a new group | Opener draft with the spec PDF

3.9 Spec template
Keep field order. Leave out any field the model isn't sure about. Include the certificate line only if the listing shows one is required.
Example (Replacement Mop Head):
Dimensions: 10 x 8 x 6 cm ; 14.08 ounces
75% Recycled Cotton 25% Recycled Blend Fiber (polyester/cotton blend or synthetic blend)
Reusable; Machine washable
Material: 4-Ply Twist Yarn Construction
Double stitched tailband
Compatible with: Clamp style handles ; Side loading handles; Universal fit headband
Certificate – (only if required)
