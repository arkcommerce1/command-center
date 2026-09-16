---
name: cc-contacts
description: Identify unknown senders and keep factory contacts correct.
version: 1.0.0
author: Ark Commerce
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [command-center, contacts]
    category: Tools
---

# cc-contacts

## When to Use

A `contacts` job is queued by `POST /api/agent/ingest` whenever a message
arrives from an unknown sender (no `contact_id`). The command_center
plugin's job poller claims these jobs and runs this procedure
**deterministically in code — no LLM is ever called** for contacts jobs.
This skill documents that exact procedure so runs, reviews, and fixture
tests all agree on what the poller does.

## Procedure

The job payload carries a sender snapshot: `chat` (external_id, channel,
name, kind, factory_id), `sender` (external_id, name, contact_id if known),
`message` (id, text), and for email also `email` (from, domain, signature)
plus `existing_contacts` (id, name, channels) and `known_factories`
(id, name, company, domains) for matching. Every automatic action is
logged in the gateway log and recorded with Undo on the server.

1. **New person in a WhatsApp group.** Sender has no contact and no
   existing contact holds their channel. Create one contact via
   `POST /api/agent/contacts`: `type: factory`, `factory_id` from the
   chat (blank when the chat has no known factory), `role: sales_agent`,
   `role_source: default`, one-line description templated as
   `WhatsApp <sender id> in <chat name>`, and one channel
   `{kind: whatsapp, value: <sender id>}`. Name is the sender's display
   name, falling back to the sender id. Never invent a role, a company,
   or a description beyond this template.
2. **Role from the person's own words only.** Change the role with
   `PATCH /api/agent/contacts/:id` only when the message text matches a
   self-statement pattern — `i am`, `i'm`, `my name is`, `this is` —
   **and** the same message contains a role word mapping to `sales_agent`
   (sale/sales/account manager), `designer` (design), `logistics`
   (logistics/shipping/freight/warehouse), `owner_manager`
   (owner/manager/boss/director/ceo/founder), `qc` (qc/quality/inspector),
   or `other` (assistant/coordinator/representative). Set `role`,
   `role_note` to their words (the matching sentence, trimmed), set
   `role_source` to `self_stated`, and set `role_proof_message_id` to the
   message text. Someone else describing them ("Ali handles logistics")
   never changes the role — log it and do nothing.
3. **Email senders.** Match by exact email channel first: if an existing
   contact already holds the address, attach to that contact and log it.
   Otherwise match by domain, company name, or signature substring
   against known factories. When confident, create the contact (or reuse
   the matched one) with that `factory_id` and the email channel. When
   not confident, create the entry with `factory_id` blank and
   description prefixed `Unmatched sender` (server schema has no company
   field; `company: Unmatched` is encoded there). No drafts are ever
   queued for unmatched senders.
4. **Merging.** When a phone number in a signature or an email address
   matches a channel on an existing contact, merge with
   `POST /api/agent/contacts/merge` (`keep_id`, `merge_id`). If the merge
   endpoint is unreachable, log the match and leave both rows for Haim —
   never delete or rewrite contact data to fake a merge.

## Pitfalls

- Never change a role on third-party descriptions. The speaker must be
  the contact themselves.
- Never invent companies, roles, or description details. Blank factory
  beats a guessed factory.
- `PATCH /api/agent/contacts/:id` accepts no `channels` field: a
  channel can only be attached at create time or via the merge endpoint.
  Log the gap instead of working around it.
- Minimal job payloads (`chat_id` + `message_id` only, no sender
  snapshot) cannot be processed — log and mark done so the job does not
  poison-loop; sender snapshots must be embedded at queue time.
- Dry-run mode (`dry_run` payload flag or `CC_CONTACTS_DRYRUN=1`) builds
  the exact request bodies but performs zero API calls.

## Verification

Simulate the handler functions directly in Python on the VPS with
fabricated payloads in dry-run mode — never write test data to
production. Fixtures: a new sender in a test group yields one create
with role Sales agent; "I'm Ali, the logistics manager" from Ali yields
a role Logistics patch with proof linked; "Ali handles logistics" from
someone else yields no role change; an email from a known contact's
address attaches; an unknown sender with no match yields an Unmatched
entry; a signature phone matching an existing channel yields a merge.
Each run must also assert zero HTTP calls in dry-run. Live proof still
needs real traffic: a first real unknown sender, a real self-stated
role, and a real merge (see docs/STACK.md).
