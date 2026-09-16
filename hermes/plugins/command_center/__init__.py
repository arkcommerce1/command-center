"""command_center plugin — Donna's bridge to the Command Center dashboard.

SPEC docs/SPEC.md §1.4. Six parts:
 1. silent ingest (pre_gateway_dispatch): factory-chat messages are POSTed to
    /api/agent/ingest and dropped from normal dispatch (return {"action":"skip"}),
    so no agent session ever auto-replies in a factory chat.
 2. job runner: polls /api/agent/jobs/claim every 5s. Handles cc-echo jobs
    inline (other job types unlock with Goals 3-8 and are left queued).
 3. outbox sender: polls /api/agent/outbox/claim + /api/agent/notifications/claim
    every 10s; sends bubbles 2-4s apart through the local WhatsApp bridge.
 4. tick: POST /api/agent/tick every 15 min.
 5. send block (pre_tool_call): vetoes messaging-tool calls aimed at chats with
    factory members. Fail closed.
 6. cc_* tools: thin wrappers over the Agent API (server enforces the rules).
    Plus the §0.2 product-rules system prompt section (<=4000 chars).

Only stdlib is used. Every network call is best-effort with short timeouts and
never raises into the gateway.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import threading
import time
import urllib.request

logger = logging.getLogger(__name__)

BASE_URL = "https://command-center-review-tau.vercel.app"
BRIDGE_URL = "http://127.0.0.1:3001"

# Job types this runner executes inline. contacts (Goal 3) runs
# deterministically in code (see cc-contacts skill): no LLM involved.
HANDLED_JOB_TYPES = {"cc-echo", "contacts"}

# Set to "1" to build contacts request bodies without performing any
# API call (used by fixture simulations; also honored per-payload via
# payload["dry_run"]).
DRYRUN_ENV = "CC_CONTACTS_DRYRUN"

# Messaging tools the send-block watches (fail closed: substring match).
SEND_TOOLS = ("send_message", "send_whatsapp", "whatsapp_send")


def _profile_home() -> str:
    return (
        os.environ.get("HERMES_HOME")
        or os.path.expanduser("~/.hermes/profiles/donna-factory")
    )


def _read_token() -> str:
    """Bearer token from Donna's .env. Empty string when absent (fail closed)."""
    for path in (
        os.path.join(_profile_home(), ".env"),
        os.path.expanduser("~/.hermes/.env"),
    ):
        with contextlib.suppress(OSError):
            with open(path, encoding="utf-8") as f:
                for line in f:
                    if line.startswith("CC_AGENT_TOKEN="):
                        return line.split("=", 1)[1].strip().strip("\"'")
    return ""


def _ingest_mode() -> str:
    for path in (
        os.path.join(_profile_home(), ".env"),
        os.path.expanduser("~/.hermes/.env"),
    ):
        with contextlib.suppress(OSError):
            with open(path, encoding="utf-8") as f:
                for line in f:
                    if line.startswith("CC_INGEST_CHATS="):
                        return line.split("=", 1)[1].strip().lower()
    return "allowlist"


def _env_from_profile(key: str, default: str = "") -> str:
    for path in (
        os.path.join(_profile_home(), ".env"),
        os.path.expanduser("~/.hermes/.env"),
    ):
        with contextlib.suppress(OSError):
            with open(path, encoding="utf-8") as f:
                for line in f:
                    if line.startswith(key + "="):
                        return line.split("=", 1)[1].strip().strip("\"'")
    return os.environ.get(key, default)


def _allowlist() -> set:
    raw = _env_from_profile("CC_INGEST_ALLOW", "CC Test")
    return {c.strip().lower() for c in raw.split(",") if c.strip()}


def _haim_ids() -> set:
    raw = os.environ.get("CC_HAIM_IDS", "Haim Setton,19179571149")
    return {c.strip().lower() for c in raw.split(",") if c.strip()}


def _api(method: str, path: str, body=None):
    """Call the Agent API. Returns parsed JSON or None on any failure."""
    token = _read_token()
    if not token:
        logger.warning("command_center: CC_AGENT_TOKEN missing, skipping %s", path)
        return None
    try:
        data = json.dumps(body or {}).encode() if method != "GET" else None
        req = urllib.request.Request(
            BASE_URL + path,
            data=data,
            method=method,
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token,
            },
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode() or "{}")
    except Exception as exc:  # best-effort: never raise into the gateway
        logger.warning("command_center: API %s %s failed: %s", method, path, exc)
        return None


def _is_haim_dm(source) -> bool:
    if (getattr(source, "chat_type", "") or "") != "dm":
        return False
    ids = _haim_ids()
    uid = str(getattr(source, "user_id", "") or "").lower()
    uname = str(getattr(source, "user_name", "") or "").lower()
    return uid in ids or uname in ids


def _chat_allowed(source) -> bool:
    mode = _ingest_mode()
    if mode == "all":
        return True
    name = str(getattr(source, "chat_name", "") or "").lower()
    cid = str(getattr(source, "chat_id", "") or "").lower()
    return name in _allowlist() or cid in _allowlist()


def on_pre_gateway_dispatch(event=None, gateway=None, **_):
    """Silent ingest. Factory-chat messages go to the dashboard, never to a session."""
    _ensure_workers_started()
    try:
        source = getattr(event, "source", None)
        platform = getattr(getattr(source, "platform", None), "value", "") or ""
        if platform not in ("whatsapp", "email"):
            return None
        if _is_haim_dm(source):
            return None  # Haim's DM keeps working normally
        if not _chat_allowed(source):
            return None  # not allowlisted: leave current behavior untouched
        chat_type = getattr(source, "chat_type", "") or "group"
        kind = "dm" if chat_type == "dm" else ("email_thread" if platform == "email" else "group")
        body = {
            "external_id": f"{platform}:{getattr(event, 'message_id', '') or int(time.time()*1000)}",
            "chat": {
                "external_id": f"{platform}:{getattr(source, 'chat_id', '')}",
                "channel": platform,
                "name": getattr(source, "chat_name", "") or "",
                "kind": kind,
            },
            "members": [
                {
                    "external_id": str(getattr(source, "user_id", "") or ""),
                    "name": getattr(source, "user_name", "") or "",
                }
            ],
            "message": {
                "direction": "in",
                "text": getattr(event, "text", "") or "",
                "media": getattr(event, "media_urls", []) or [],
                "sent_at": int(time.time() * 1000),
            },
        }
        res = _api("POST", "/api/agent/ingest", body)
        logger.info(
            "command_center: ingested %s chat=%s deduped=%s",
            platform, getattr(source, "chat_name", "") or getattr(source, "chat_id", ""),
            (res or {}).get("deduped"),
        )
        return {"action": "skip", "reason": "ingested-to-command-center"}
    except Exception as exc:
        logger.warning("command_center: ingest failed open (allowing dispatch): %s", exc)
        return None


def on_pre_tool_call(tool_name: str = "", args=None, **_):
    """Veto messaging-tool calls aimed at factory chats. Fail closed."""
    try:
        name = str(tool_name or "").lower()
        if not any(t in name for t in SEND_TOOLS):
            return None
        a = args if isinstance(args, dict) else {}
        target = json.dumps(a).lower()
        # Block when the target looks like a factory chat. Haim/Yuki DMs and
        # internal groups are not blocked here (outbox sender handles those).
        if "cc test" in target or "factory" in target or "group" in target:
            logger.warning("command_center: blocked messaging tool call to factory chat: %s", tool_name)
            return {
                "action": "block",
                "message": "BLOCKED by command_center send-block: messages to factory chats require Haim's dashboard approval.",
            }
        return None
    except Exception:
        return {
            "action": "block",
            "message": "BLOCKED by command_center send-block: gate error, failing closed.",
        }


# ---------------------------------------------------------------- tools ---

def _tool_handler(path: str, method: str = "POST"):
    def handler(payload=None, **kwargs):
        body = payload if isinstance(payload, dict) else dict(kwargs)
        return _api(method, path, body) or {"ok": False, "error": "api-unreachable"}
    return handler


CC_ENDPOINTS = [
    ("cc_ingest", "/api/agent/ingest"),
    ("cc_tick", "/api/agent/tick"),
    ("cc_context", "/api/agent/context", "GET"),
    ("cc_contacts_create", "/api/agent/contacts"),
    ("cc_questions", "/api/agent/questions"),
    ("cc_quotes", "/api/agent/quotes"),
    ("cc_adjustments", "/api/agent/adjustments"),
    ("cc_open_items", "/api/agent/open-items"),
    ("cc_samples", "/api/agent/samples"),
    ("cc_shipments", "/api/agent/shipments"),
    ("cc_notifications", "/api/agent/notifications"),
    ("cc_drafts", "/api/agent/drafts"),
    ("cc_status", "/api/agent/status"),
    ("cc_steps", "/api/agent/steps"),
]


PRODUCT_RULES = """Command Center product rules (enforced by the dashboard API, not by you):
1. No message goes to a factory chat without Haim's approval of that exact version.
2. You may message only Haim, Yuki, and internal chats automatically.
3. Never negotiate: no prices, discounts, minimum orders, payment terms, volumes, or commitments. Quotes are logged for Haim only.
4. You may name AllSett Health, Refreshify, Everlasting. Never state volumes unless that factory allows it.
5. Outgoing messages are English only.
6. Ask for a sample only after the spec is agreed. Sample fees always go to Haim.
7. Never pushy about ship timing. No manual data entry: fill data from chats and listings; Haim can edit anything."""


# --------------------------------------------------- contacts (Goal 3) ---
# Deterministic contacts processor (cc-contacts skill). No LLM: pure
# regex + exact/substring matching, then plain Agent API calls. Every
# automatic action is logged; dry-run builds bodies without calling.

import re as _re

_SELF_PATTERNS = (
    _re.compile(r"\bi\s+am\b", _re.I),
    _re.compile(r"\bi['\u2019]m\b", _re.I),
    _re.compile(r"\bmy\s+name\s+is\b", _re.I),
    _re.compile(r"\bthis\s+is\b", _re.I),
)

# Ordered: first match wins ("sales manager" must beat owner_manager's
# "manager"; "account manager" likewise).
_ROLE_KEYWORDS = (
    ("sales_agent", ("account manager", "sales manager", "sales", "sale",
                     "salesman", "saleswoman", "salesperson",
                     "business development")),
    ("designer", ("designer", "design",)),
    ("logistics", ("logistics", "supply chain", "shipping", "freight",
                   "warehouse",)),
    ("owner_manager", ("general manager", "owner", "manager", "boss",
                       "director", "ceo", "founder", "president",)),
    ("qc", ("inspector", "inspection", "quality", "qc",)),
    ("other", ("merchandiser", "representative", "coordinator",
               "assistant", "secretary", "clerk",)),
)


def detect_self_stated_role(text: str):
    """Return (role, role_note) when the text is the sender stating their
    own role, else None. role_note is the matching sentence, trimmed."""
    t = (text or "").strip()
    if not t:
        return None
    if not any(p.search(t) for p in _SELF_PATTERNS):
        return None
    low = t.lower()
    for role, words in _ROLE_KEYWORDS:
        for w in words:
            if w in low:
                # role_note: first sentence containing the role word.
                note = t
                for sent in _re.split(r"(?<=[.!?])\s+|\n+", t):
                    if w in sent.lower():
                        note = sent.strip()
                        break
                return role, note[:200]
    return None


def _is_dryrun(payload: dict) -> bool:
    return bool((payload or {}).get("dry_run")) or os.environ.get(DRYRUN_ENV) == "1"


def plan_contacts_actions(payload: dict) -> list:
    """Pure planner: payload -> [(method, path, body, why), ...].

    Payload blocks: chat{channel,name,kind,factory_id}, sender
    {external_id,name,contact_id}, message{id,text}, email{from,domain,
    signature}, existing_contacts[{id,name,channels[{kind,value}]}],
    known_factories[{id,name,company,domains[]}]. Minimal payloads
    ({chat_id,message_id} only) yield a single ("log-only", ...) entry.
    """
    p = payload or {}
    chat = p.get("chat") or {}
    sender = p.get("sender") or {}
    message = p.get("message") or {}
    actions: list = []

    if not chat and set(p.keys()) <= {"chat_id", "message_id", "dry_run"}:
        actions.append(("log-only", "contacts/minimal-payload", {},
                        "minimal payload (chat_id+message_id, no sender "
                        "snapshot): cannot resolve sender without a lookup "
                        "endpoint; needs ingest enrichment (see STACK)"))
        return actions

    channel = str(chat.get("channel", "whatsapp") or "whatsapp").lower()
    chat_name = str(chat.get("name", "") or "")
    factory_id = str(chat.get("factory_id", "") or "")
    sender_id = str(sender.get("external_id", "") or "")
    sender_name = str(sender.get("name", "") or "") or sender_id
    sender_contact = str(sender.get("contact_id", "") or "")
    text = str(message.get("text", "") or "")
    msg_id = str(message.get("id", "") or "")
    existing = p.get("existing_contacts") or []

    def find_by_channel(kind: str, value: str):
        v = (value or "").strip().lower()
        if not v:
            return None
        for c in existing:
            for ch in (c.get("channels") or []):
                if (str(ch.get("kind", "")).lower() == kind
                        and str(ch.get("value", "")).strip().lower() == v):
                    return c
        return None

    if channel == "email":
        email = p.get("email") or {}
        frm = str(email.get("from", "") or sender_id or "").strip()
        domain = str(email.get("domain", "") or "")
        if "@" in frm and not domain:
            domain = frm.split("@", 1)[1].lower()
        sig = str(email.get("signature", "") or "")
        known = p.get("known_factories") or []
        hit = find_by_channel("email", frm)
        if hit:
            actions.append(("log-only", "contacts/email-attach", {},
                            f"email {frm} already on contact {hit.get('id')}: "
                            "attached, nothing to create"))
            # No return: fall through to role + merge checks below.
        matched_factory = ""
        if not hit and domain:
            for f in known:
                doms = [str(d).lower() for d in (f.get("domains") or [])]
                blob = (str(f.get("name", "")) + " " + str(f.get("company", ""))).lower()
                if (domain in doms or blob.strip()
                        and (domain.split(".")[0] in blob
                             or any(w in (sig + " " + frm).lower()
                                    for w in blob.split() if len(w) > 3))):
                    matched_factory = str(f.get("id", ""))
                    break
        if matched_factory and not hit:
            body = {"name": sender_name or frm, "type": "factory",
                    "factory_id": matched_factory, "role": "sales_agent",
                    "role_source": "default",
                    "description": f"Email {frm} matched to factory",
                    "channels": [{"kind": "email", "value": frm}]}
            actions.append(("POST", "/api/agent/contacts", body,
                            f"email {frm} matched to factory {matched_factory}"))
        elif not hit:
            body = {"name": sender_name or frm, "type": "factory",
                    "factory_id": "", "role": "sales_agent",
                    "role_source": "default",
                    "description": f"Unmatched sender {frm}: {text[:120]}",
                    "channels": ([{"kind": "email", "value": frm}] if frm else [])}
            actions.append(("POST", "/api/agent/contacts", body,
                            f"email {frm or sender_name} has no factory match: "
                            "Unmatched entry, no drafts"))
        # Signature phone/email merge check below applies to email too.
    else:
        hit = (find_by_channel("whatsapp", sender_id)
               or (next((c for c in existing
                         if str(c.get("id")) == sender_contact), None)
                   if sender_contact else None))
        if hit is None and sender_id:
            desc = f"WhatsApp {sender_id} in {chat_name}".strip()
            body = {"name": sender_name, "type": "factory",
                    "factory_id": factory_id, "role": "sales_agent",
                    "role_source": "default", "description": desc,
                    "channels": [{"kind": "whatsapp", "value": sender_id}]}
            actions.append(("POST", "/api/agent/contacts", body,
                            f"new sender {sender_id} in group {chat_name}: "
                            "create factory contact (default Sales agent)"))
        elif hit is not None:
            actions.append(("log-only", "contacts/known-sender", {},
                            f"sender {sender_id} already contact "
                            f"{hit.get('id')}: no create"))

    # Role self-statement: only when the speaker IS the contact (message
    # author == sender, never a third party describing them).
    speaker_is_subject = p.get("speaker_is_subject", True)
    if text and speaker_is_subject:
        role_hit = detect_self_stated_role(text)
        has_create = any(a[0] == "POST" and a[1] == "/api/agent/contacts"
                         for a in actions)
        if role_hit and (sender_contact or has_create):
            role, note = role_hit
            if sender_contact:
                actions.append(("PATCH",
                                f"/api/agent/contacts/{sender_contact}",
                                {"role": role, "role_note": note,
                                 "role_source": "self_stated",
                                 "role_proof_message_id": text[:500]},
                                f"self-stated role {role} for "
                                f"{sender_contact}: proof linked"))
            else:
                # Fold into the just-planned create: self-stated at birth.
                for i, a in enumerate(actions):
                    if a[0] == "POST" and a[1] == "/api/agent/contacts":
                        body = dict(a[2])
                        body["role"] = role
                        body["role_note"] = note
                        body["role_source"] = "self_stated"
                        body["role_proof_message_id"] = text[:500]
                        actions[i] = (a[0], a[1], body,
                                      a[3] + f"; self-stated role {role} at create")
        elif role_hit:
            actions.append(("log-only", "contacts/role-no-target", {},
                            "self-stated role found but sender contact "
                            "unknown and no create planned: no change"))
    if "speaker_is_subject" in p and not p.get("speaker_is_subject"):
        actions.append(("log-only", "contacts/third-party", {},
                        "third-party description of contact: role unchanged"))

    # Merge: phone-in-signature or email matching another contact's channel.
    sig_text = str((p.get("email") or {}).get("signature", "") or "")
    phones = set(_re.findall(r"\+?\d[\d\s\-()]{6,}\d", sig_text + " " + text))
    emails = set(m.lower() for m in _re.findall(
        r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", (sig_text + " " + text).lower()))
    for c in existing:
        if sender_contact and str(c.get("id")) == sender_contact:
            continue
        for ch in (c.get("channels") or []):
            k, v = str(ch.get("kind", "")).lower(), str(ch.get("value", ""))
            if ((k == "whatsapp" and v in phones)
                    or (k == "email" and v.lower() in emails)):
                other = sender_contact or next(
                    (a[2].get("__new_id", "") for a in actions
                     if a[0] == "POST"), "")
                actions.append(("POST", "/api/agent/contacts/merge",
                                {"keep_id": str(c.get("id")),
                                 "merge_id": other or sender_id},
                                f"signature match ({k}:{v}) merges into "
                                f"{c.get('id')}; fallback is log-only since "
                                "PATCH accepts no channels"))
                break
    return actions


def _execute_contacts_actions(actions: list, dry_run: bool) -> None:
    for method, path, body, why in actions:
        clean = {k: v for k, v in (body or {}).items()
                 if not k.startswith("__")}
        if method == "log-only" or dry_run:
            logger.info("command_center: contacts %s %s %s [dry_run=%s]",
                        "NOTE " if method == "log-only" else "would POST",
                        path, why, dry_run)
            continue
        res = _api(method, path, clean)
        logger.info("command_center: contacts %s %s ok=%s (%s)",
                    method, path, bool(res and res.get("contact", res)), why)


def _run_contacts_job(job: dict) -> None:
    payload = job.get("payload") or {}
    dry_run = _is_dryrun(payload)
    actions = plan_contacts_actions(payload)
    _execute_contacts_actions(actions, dry_run)
    logger.info("command_center: contacts job %s planned %d action(s) dry_run=%s",
                job.get("id"), len(actions), dry_run)


# ------------------------------------------------------------- workers ---

_workers_started = False
_workers_lock = threading.Lock()


def _ensure_workers_started() -> None:
    global _workers_started
    with _workers_lock:
        if _workers_started:
            return
        _workers_started = True
    for target, name in (
        (_job_loop, "cc-jobs"),
        (_outbox_loop, "cc-outbox"),
        (_tick_loop, "cc-tick"),
    ):
        t = threading.Thread(target=target, name=name, daemon=True)
        t.start()
    logger.info("command_center: background workers started (jobs/outbox/tick)")


def _job_loop() -> None:
    while True:
        try:
            time.sleep(5)
            for job_type in sorted(HANDLED_JOB_TYPES):
                res = _api("POST", "/api/agent/jobs/claim", {"type": job_type})
                job = (res or {}).get("job")
                if job:
                    _run_job(job)
        except Exception as exc:
            logger.warning("command_center: job loop error: %s", exc)


def _run_job(job: dict) -> None:
    jid = job.get("id")
    try:
        if job.get("type") == "cc-echo":
            note = (job.get("payload") or {}).get("note", "echo-ok")
            _api("POST", "/api/agent/status", {
                "status_sentence": f"cc-echo: {note}",
                "waiting_on": "none",
                "next_step": "",
            })
        elif job.get("type") == "contacts":
            _run_contacts_job(job)  # deterministic, no LLM (Goal 3)
        _api("POST", f"/api/agent/jobs/{jid}/done", {})
        logger.info("command_center: job %s (%s) done", jid, job.get("type"))
    except Exception as exc:
        logger.warning("command_center: job %s failed: %s", jid, exc)
        _api("POST", f"/api/agent/jobs/{jid}/failed", {"error": str(exc)[:500]})


def _bridge_send(chat_id: str, text: str):
    """Send one WhatsApp bubble through the local Baileys bridge."""
    try:
        req = urllib.request.Request(
            BRIDGE_URL + "/send",
            data=json.dumps({"chatId": chat_id, "message": text}).encode(),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode() or "{}")
    except Exception as exc:
        return {"error": str(exc)[:300]}


def _outbox_loop() -> None:
    while True:
        try:
            time.sleep(10)
            for kind in ("outbox", "notifications"):
                res = _api("POST", f"/api/agent/{kind}/claim", {})
                row = (res or {}).get("row") or (res or {}).get("notification")
                if not row:
                    continue
                _send_row(kind, row)
        except Exception as exc:
            logger.warning("command_center: outbox loop error: %s", exc)


def _send_row(kind: str, row: dict) -> None:
    rid = row.get("id")
    try:
        chat_id = row.get("chat_id", "")
        bubbles = row.get("bubbles") or ([row.get("text")] if row.get("text") else [])
        ids = []
        for bubble in bubbles:
            if not bubble:
                continue
            res = _bridge_send(chat_id, bubble)
            if res.get("error"):
                raise RuntimeError(res["error"])
            mid = res.get("messageId") or res.get("id") or "ok"
            ids.append(mid)
            time.sleep(3)  # 2-4s spacing between bubbles
        _api("POST", f"/api/agent/{kind}/{rid}/sent", {"external_message_ids": ids})
        logger.info("command_center: %s %s sent (%d bubbles)", kind, rid, len(ids))
    except Exception as exc:
        logger.warning("command_center: %s %s failed: %s", kind, rid, exc)
        _api("POST", f"/api/agent/{kind}/{rid}/failed", {"error": str(exc)[:500]})


def _tick_loop() -> None:
    while True:
        try:
            time.sleep(15 * 60)
            res = _api("POST", "/api/agent/tick", {})
            logger.info("command_center: tick ok=%s queued=%s", (res or {}).get("ok"), (res or {}).get("queued"))
        except Exception as exc:
            logger.warning("command_center: tick error: %s", exc)


# ------------------------------------------------------------ register ---

def register(ctx) -> None:
    ctx.register_hook("pre_gateway_dispatch", on_pre_gateway_dispatch)
    ctx.register_hook("pre_tool_call", on_pre_tool_call)
    for spec in CC_ENDPOINTS:
        name, path = spec[0], spec[1]
        method = spec[2] if len(spec) > 2 else "POST"
        ctx.register_tool(
            name,
            "command_center",
            {"type": "object", "properties": {"payload": {"type": "object"}}, "additionalProperties": True},
            _tool_handler(path, method),
            description=f"Command Center Agent API {method} {path} (server enforces all rules).",
        )
    ctx.register_system_prompt_section(
        "cc-product-rules", PRODUCT_RULES, max_chars=4000
    )
    logger.info("command_center: registered (ingest/job/outbox/tick/send-block/%d tools)", len(CC_ENDPOINTS))
