"""command_center plugin — Donna's bridge to the Command Center dashboard.

SPEC docs/SPEC.md §1.4. Six parts:
 1. silent ingest (pre_gateway_dispatch): factory-chat messages are POSTed to
    /api/agent/ingest and dropped from normal dispatch (return {"action":"skip"}),
    so no agent session ever auto-replies in a factory chat.
 2. job runner: polls /api/agent/jobs/claim every 5s. Handles cc-echo jobs
    inline, contacts + organize deterministically in code (no LLM).
    Organize jobs buffer per chat until 2 min quiet, then process.
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
import re
import threading
import time
import urllib.request

logger = logging.getLogger(__name__)

BASE_URL = "https://command-center-review-tau.vercel.app"
BRIDGE_URL = "http://127.0.0.1:3001"

# Job types this runner executes inline. contacts (Goal 3), organize
# (Goal 6), and cc-followups (Goal 9) run deterministically in code (see
# cc-contacts / cc-organizer / cc-followups skills): no LLM involved.
HANDLED_JOB_TYPES = {"cc-echo", "contacts", "organize", "cc-followups", "draft"}

# Set to "1" to build organize request bodies without performing any
# API call (used by fixture simulations; also honored per-payload via
# payload["dry_run"]).
ORGANIZE_DRYRUN_ENV = "CC_ORGANIZE_DRYRUN"

# Chats are organized only after this many seconds with no new organize
# job queued for them (SPEC §1.4: batch per chat, 2-minute quiet period).
ORGANIZE_QUIET_S = 120

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


_APPROVAL_YN = re.compile(r"^([YN])\s*(\d+)(?:\.(\d+))?\s*$", re.IGNORECASE)
_APPROVAL_S = re.compile(r"^S\s*(\d+)(?:\.(\d+))?\s+([\s\S]+)$", re.IGNORECASE)


def _parse_approval_code(text: str):
    """Mirror of dashboard src/lib/cc/approval-codes.ts. Returns a dict or None."""
    t = (text or "").strip()
    m = _APPROVAL_YN.match(t)
    if m:
        return {"action": "approve" if m.group(1).upper() == "Y" else "disapprove", "code": t}
    m = _APPROVAL_S.match(t)
    if m and (m.group(3) or "").strip():
        return {"action": "suggest", "code": t}
    return None


def _handle_haim_dm_approval(source, event) -> dict | None:
    """Haim's WhatsApp shortcut (Goal 7): Y/N/S codes go to /api/agent/approval-reply,
    never to an agent session. Returns a skip verdict, or None to keep normal dispatch."""
    text = str(getattr(event, "text", "") or "")
    if not _parse_approval_code(text):
        return None
    res = _api("POST", "/api/agent/approval-reply", {
        "text": text.strip(),
        "from": str(getattr(source, "user_id", "") or getattr(source, "user_name", "") or ""),
    })
    logger.info("command_center: approval-reply %s -> %s", text.strip()[:60], (res or {}).get("action"))
    return {"action": "skip", "reason": "haim-approval-code"}


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
            # Haim's DM: approval codes go to approval-reply, never to an agent.
            # Everything else keeps working normally.
            verdict = _handle_haim_dm_approval(source, event)
            return verdict
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


# --------------------------------------------------- organizer (Goal 6) ---
# Deterministic organizer processor (cc-organizer skill). No LLM: pure
# regex + substring matching, then plain Agent API calls. Every
# automatic action is logged; dry-run builds bodies without calling.

_ACK_ONLY = {
    "ok", "okay", "okay thanks", "noted", "noted thanks", "received",
    "thanks", "thank you", "got it", "please wait", "one moment",
    "好的", "收到", "稍等",
}

_GREET_ONLY = _re.compile(
    r"^(hi|hello|hey|yo|good\s+(morning|afternoon|evening)|你好|您好)"
    r"[!.,\s]*$", _re.I)

_STEP2_PAT = _re.compile(
    r"(we\s+can\s+(make|manufacture|produce|do)|yes[,\s]+we\s+can\s+"
    r"(make|do|produce)|(can\s+be\s+(made|produced|manufactured))|"
    r"(able\s+to\s+(make|produce))|可以(做|生产|做))", _re.I)

_STEP3_PAT = _re.compile(
    r"((confirm|agree|approve|accept)[^.]{0,40}spec|spec[^.]{0,40}"
    r"(confirm|ok|okay|agree|approve|accept|fine|good|correct|match)|"
    r"(确认|同意)[^.]{0,20}spec|spec[^.]{0,20}(没问题|可以))", _re.I)

_STEP4_PAT = _re.compile(
    r"((we(\'ll| will)\s+send|will\s+send|send|ship|arrange)[^.]{0,40}"
    r"sample|sample[^.]{0,40}(send|ship|arrange)|寄样|发样品|"
    r"样品.{0,10}寄出)", _re.I)

_TRACKING_PAT = _re.compile(
    r"\b([A-Z]{2}\d{9}[A-Z]{2}|SF\d{10,}|YT\d{10,}|\d{12,}|"
    r"[A-Z0-9]{10,20})\b")

_PRICE_PAT = _re.compile(
    r"(\$|US\$|USD|¥|RMB|CNY|€)\s*\d|"
    r"\d\s*(\$|US\$|USD|¥|RMB|CNY|yuan|dollars?|€)|"
    r"\b(price|pricing|cost|per unit|per piece|/pc\b|/pcs\b|unit price|"
    r"EXW|FOB|CIF|DDP|MOQ)\b.{0,30}\d|\d.{0,30}"
    r"\b(price|pricing|cost|per unit|per piece|unit price)\b", _re.I)

_FEE_PAT = _re.compile(
    r"(sample\s+fee|fee\s+for.{0,20}sample|pay.{0,20}sample|"
    r"样品费|费用.{0,10}样品|样品.{0,10}费用)", _re.I)

_CHANGE_PAT = _re.compile(
    r"\b(change|adjust|modify|revise|instead of|can we make it|"
    r"what if we|could you make)\b|改|调整|换成", _re.I)

_QUESTION_HINT = _re.compile(
    r"\?|？|\b(what|when|how|can you|could you|do you|is it|are you|"
    r"吗|呢|什么|怎么|多少|可以吗)\b", _re.I)

_MOQ_PAT = _re.compile(
    r"\b(MOQ|minimum order|order quantity|bulk order|trial order|"
    r"payment terms?|deposit|T/T|paypal|alipay)\b", _re.I)

_CJK_PAT = _re.compile(r"[\u4e00-\u9fff]")


def _strip_punct(s: str) -> str:
    return _re.sub(r"[.!…。,，、！？?~\-\–—_()\[\]{}'\"“”‘’\s]+",
                   " ", s.lower()).strip()


def is_ack_only(text: str) -> bool:
    """True for messages that only acknowledge (never step proof)."""
    t = (text or "").strip()
    if not t:
        return True
    if not _re.search(r"[a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]",
                       t, _re.I):
        return True  # emoji / thumbs-up only
    return _strip_punct(t) in _ACK_ONLY


def detect_lang(text: str) -> str:
    if _CJK_PAT.search(text or ""):
        return "zh"
    return ""


def link_product(text: str, products: list):
    """Return (factory_product_id, guessed). Single product links
    directly; multi-product matches product-name words; ties and fully
    ambiguous texts fall back to most-recently-active with guessed=True."""
    if not products:
        return "", False
    if len(products) == 1:
        return str(products[0].get("factory_product_id", "")), False
    low = (text or "").lower()
    scored = []
    for p in products:
        words = [w for w in _re.split(r"[^a-z0-9]+",
                                      str(p.get("name", "")).lower())
                 if len(w) > 2]
        hits = sum(1 for w in words if w and w in low)
        scored.append((hits, str(p.get("last_active_at", "")),
                       str(p.get("factory_product_id", ""))))
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    if scored[0][0] > 0 and (len(scored) < 2
                             or scored[0][0] > scored[1][0]
                             or scored[0][1] >= scored[1][1]):
        # Clear winner, or tied on hits but this one is most recent.
        tied = len(scored) > 1 and scored[0][0] == scored[1][0]
        return scored[0][2], tied
    most_recent = sorted(products,
                         key=lambda p: str(p.get("last_active_at", "")),
                         reverse=True)[0]
    return str(most_recent.get("factory_product_id", "")), True


def _field_guess(text: str) -> str:
    low = (text or "").lower()
    for key in ("dimension", "size", "weight", "material", "cotton",
                "color", "colour", "length", "width", "height",
                "thickness", "diameter", "package", "packaging",
                "certificate", "logo", "print"):
        if key in low:
            return key
    return "unspecified"


def plan_organize_actions(payload: dict) -> list:
    """Pure planner: payload -> [(method, path, body, why), ...].

    Rich payload blocks: chat{id,name,factory_id}, products
    [{factory_product_id,product_id,name,last_active_at}], messages
    [{id,text,direction,sender_type,sent_at}] oldest-first, plus optional
    spec{fields:[{key,tag}]}, open_change_counts{fp:n}, open_items[{id,
    kind}]. Minimal payloads ({chat_id} only, what ingest queues today)
    yield a single ("log-only", ...) entry.
    """
    p = payload or {}
    chat = p.get("chat") or {}
    if not chat and set(p.keys()) <= {"chat_id", "dry_run"}:
        return [("log-only", "organize/minimal-payload", {},
                 "minimal payload (chat_id only, no message snapshot): "
                 "cannot organize without a lookup endpoint; needs ingest "
                 "enrichment (see STACK)")]
    chat_id = str(chat.get("id", "") or p.get("chat_id", ""))
    chat_name = str(chat.get("name", "") or "")
    factory_id = str(chat.get("factory_id", "") or "")
    products = p.get("products") or []
    messages = sorted(p.get("messages") or [],
                      key=lambda m: m.get("sent_at", 0))
    spec_tags = {f.get("key", ""): str(f.get("tag", "")).lower()
                 for f in ((p.get("spec") or {}).get("fields") or [])}
    change_counts = p.get("open_change_counts") or {}
    open_items = p.get("open_items") or []
    actions: list = []

    if not factory_id:
        # New group: create factory from chat name, link chat, queue opener draft.
        factory_name = chat_name or chat_id
        factory_res = _api("POST", "/api/agent/factories", {
            "name": factory_name,
            "company_name": "",
            "chat_id": chat_id,
            "product_id": "",
        })
        new_factory_id = str((factory_res or {}).get("factory", {}).get("id", "") or "")
        if new_factory_id:
            actions.append(("log-only", "organize/new-factory", {},
                           f"created factory {new_factory_id} for chat {chat_name or chat_id}"))
            # Re-link products if any exist, else queue a product_pick question.
            if not products:
                actions.append(("POST", "/api/agent/questions",
                                {"factory_product_id": new_factory_id,
                                 "kind": "product_pick",
                                 "body": {"chat_name": chat_name, "chat_id": chat_id},
                                 "importance": "high"},
                                f"new group {chat_name}: no product match, product_pick question"))
            # Queue an opener draft job.
            actions.append(("POST", "/api/agent/jobs",
                            {"type": "draft", "payload": {
                                "factory_product_id": new_factory_id,
                                "chat_id": chat_id,
                                "kind": "opener",
                            }},
                            f"opener draft queued for new factory {new_factory_id}"))
        else:
            actions.append(("log-only", "organize/factory-create-failed", {},
                           f"failed to create factory for {chat_name}: API returned no id"))
        return actions

    touched: dict = {}  # fp_id -> per-product batch state
    track_open = {i.get("id", "") for i in open_items
                  if i.get("kind") == "sample_tracking"}

    def state(fp: str) -> dict:
        return touched.setdefault(
            fp, {"draft": "", "draft_why": "", "haim": False,
                 "guessed": False, "steps": []})

    for m in messages:
        mid = str(m.get("id", ""))
        text = str(m.get("text", "") or "")
        direction = str(m.get("direction", "in"))
        sender = str(m.get("sender_type", "factory"))
        inbound_factory = direction == "in" and sender == "factory"
        fp, guessed = link_product(text, products)
        if not fp:
            actions.append(("log-only", "organize/no-product", {},
                            f"message {mid}: no product to link, skipped"))
            continue
        st = state(fp)
        if guessed:
            st["guessed"] = True
        lang = detect_lang(text)
        non_english = bool(lang) and direction == "in"
        actions.append(
            ("POST", f"/api/agent/messages/{mid}/annotate",
             {"factory_product_id": fp,
              "translation": "",
              "lang": lang},
             f"link message {mid} to {fp}"
             + (" (guessed)" if guessed else "")))
        if non_english:
            actions.append(
                ("POST", "/api/agent/questions",
                 {"factory_product_id": fp, "kind": "question",
                  "body": {"issue": "untranslated_text",
                           "message_id": mid, "lang": lang},
                  "importance": "low"},
                 f"message {mid} is non-English: no guessed translation, "
                 "question card for Haim"))
            st["haim"] = True
        if not inbound_factory:
            continue
        ack = is_ack_only(text)
        greeting = bool(_GREET_ONLY.match(text.strip()))
        if ack or greeting:
            continue  # log only: never a step, never a draft
        # --- steps (proof patterns only) ---
        if len(text) >= 12 or any(
                w in text.lower()
                for prod in products
                for w in str(prod.get("name", "")).lower().split()
                if len(w) > 3):
            actions.append(
                ("POST", "/api/agent/steps",
                 {"factory_product_id": fp, "step": 1,
                  "proof_message_id": mid},
                 f"step 1 proof: real reply about product ({mid})"))
            st["steps"].append(1)
        if _STEP2_PAT.search(text):
            actions.append(
                ("POST", "/api/agent/steps",
                 {"factory_product_id": fp, "step": 2,
                  "proof_message_id": mid},
                 f"step 2 proof: can-make-it ({mid})"))
            st["steps"].append(2)
        if _STEP3_PAT.search(text) and int(change_counts.get(fp, 0)) == 0:
            actions.append(
                ("POST", "/api/agent/steps",
                 {"factory_product_id": fp, "step": 3,
                  "proof_message_id": mid},
                 f"step 3 proof: spec confirmed, no open changes ({mid})"))
            st["steps"].append(3)
        if _STEP4_PAT.search(text):
            actions.append(
                ("POST", "/api/agent/steps",
                 {"factory_product_id": fp, "step": 4,
                  "proof_message_id": mid},
                 f"step 4 proof: sample committed ({mid})"))
            st["steps"].append(4)
            if not any(i.get("kind") == "sample_tracking"
                       for i in open_items):
                actions.append(
                    ("POST", "/api/agent/open-items",
                     {"factory_product_id": fp, "direction": "they_owe",
                      "kind": "sample_tracking",
                      "summary": "Factory committed sample, "
                                 "awaiting tracking number",
                      "opened_message_id": mid},
                     f"sample_tracking opened for {fp}"))
        for trk in _TRACKING_PAT.findall(text):
            actions.append(
                ("POST", "/api/agent/steps",
                 {"factory_product_id": fp, "step": 5,
                  "proof_message_id": mid},
                 f"step 5 proof: tracking {trk} ({mid})"))
            st["steps"].append(5)
            actions.append(
                ("POST", "/api/agent/shipments",
                 {"leg": "china_to_yiwu", "tracking_number": trk,
                  "carrier": "", "status": "created"},
                 f"china shipment for tracking {trk}"))
            for oid in track_open:
                actions.append(
                    ("POST", f"/api/agent/open-items/{oid}/resolve", {},
                     f"tracking {trk} resolves sample_tracking {oid}"))
            track_open.clear()
            st["draft"] = ("Thanks — got the tracking number, "
                           "we'll watch for it.")
            st["draft_why"] = "§3.8 tracking-number thanks"
            break
        # --- quotes (Haim only; drafts stay number-free) ---
        if _PRICE_PAT.search(text):
            actions.append(
                ("POST", "/api/agent/quotes",
                 {"factory_product_id": fp, "message_id": mid,
                  "text": text[:500]},
                 f"price quote recorded for Haim ({mid})"))
            if not st["draft"]:
                st["draft"] = ("Thanks for the details — let's confirm "
                               "the spec so we can move to a sample.")
                st["draft_why"] = "§3.8 price-quote thanks (no numbers)"
        # --- fee requests -> fee card, never agree ---
        if _FEE_PAT.search(text):
            actions.append(
                ("POST", "/api/agent/questions",
                 {"factory_product_id": fp, "kind": "fee",
                  "body": {"message_id": mid, "text": text[:500]},
                  "importance": "high"},
                 f"sample fee request -> fee card ({mid})"))
            st["haim"] = True
            continue
        # --- spec changes ---
        if _CHANGE_PAT.search(text):
            key = _field_guess(text)
            tag = spec_tags.get(key, "")
            result = ("accepted" if tag == "flexible"
                      else "declined" if tag == "locked" else "pending")
            actions.append(
                ("POST", "/api/agent/adjustments",
                 {"factory_product_id": fp, "field_key": key,
                  "proposed_value": text[:300], "message_id": mid,
                  "result": result},
                 f"proposed spec change ({key}={result}) ({mid})"))
            if result == "pending":
                actions.append(
                    ("POST", "/api/agent/open-items",
                     {"factory_product_id": fp, "direction": "we_owe",
                      "kind": "question",
                      "summary": f"Spec change proposal ({key}): "
                                 f"{text[:120]}",
                      "opened_message_id": mid},
                     "no spec tags in payload: Haim decides"))
                st["haim"] = True
            elif not st["draft"]:
                st["draft"] = ("Noted on the spec point — we'll confirm "
                               "and get back to you.")
                st["draft_why"] = "§3.8 change proposal acknowledgement"
        # --- reply decision per §3.8 ---
        if not st["draft"]:
            if _MOQ_PAT.search(text):
                actions.append(
                    ("POST", "/api/agent/questions",
                     {"factory_product_id": fp, "kind": "question",
                      "body": {"issue": "order_terms",
                               "message_id": mid, "text": text[:300]},
                      "importance": "medium"},
                     f"MOQ/payment terms -> question card ({mid})"))
                st["haim"] = True
            elif _QUESTION_HINT.search(text):
                if any(w in text.lower()
                       for w in ("spec", "dimension", "size", "material",
                                 "weight", "color", "certificate")):
                    st["draft"] = ("Good question — checking against our "
                                   "spec and will reply shortly.")
                    st["draft_why"] = "§3.8 spec-answerable question"
                else:
                    actions.append(
                        ("POST", "/api/agent/open-items",
                         {"factory_product_id": fp,
                          "direction": "we_owe", "kind": "question",
                          "summary": text[:150],
                          "opened_message_id": mid},
                         f"spec-gap question opened ({mid})"))
                    st["haim"] = True
            elif 2 in st["steps"] and 3 not in st["steps"]:
                st["draft"] = ("Great — could you confirm the spec so we "
                               "can move to a sample?")
                st["draft_why"] = "§3.8 step-2 spec confirmation request"
            elif 3 in st["steps"] or 4 in st["steps"]:
                st["draft"] = ("Thanks — looking forward to the sample.")
                st["draft_why"] = "§3.8 post-confirmation thanks"

    for fp, st in touched.items():
        waiting = "haim" if (st["haim"] or st["draft"]) else "factory"
        first_undone = next(
            (s for s in (1, 2, 3, 4, 5) if s not in st["steps"]), None)
        nxt = (f"step {first_undone}" if first_undone
               else "sample in transit")
        steps_done = sorted(set(st["steps"]))
        summary = ("Batch organized: steps "
                   + (str(steps_done) if steps_done else "none")
                   + " marked"
                   + ("; product link guessed" if st["guessed"] else ""))
        note = (f"product_guessed:{fp}" if st["guessed"] else "")
        actions.append(
            ("POST", "/api/agent/status",
             {"factory_product_id": fp, "status_sentence": summary,
              "waiting_on": waiting, "next_step": nxt, "note": note},
             f"status for {fp}: waiting_on={waiting}, next={nxt}"))
        if st["draft"]:
            actions.append(
                ("POST", "/api/agent/drafts",
                 {"factory_product_id": fp, "chat_id": chat_id,
                  "kind": "reply", "reason": st["draft_why"],
                  "bubbles": [st["draft"]], "source": "ai"},
                 f"reply draft ({st['draft_why']})"))
    return actions


def _is_organize_dryrun(payload: dict) -> bool:
    return bool((payload or {}).get("dry_run")) or os.environ.get(
        ORGANIZE_DRYRUN_ENV) == "1"


def _execute_organize_actions(actions: list, dry_run: bool) -> None:
    for method, path, body, why in actions:
        if method == "log-only" or dry_run:
            logger.info("command_center: organize %s %s %s [dry_run=%s]",
                        "NOTE " if method == "log-only" else "would POST",
                        path, why, dry_run)
            continue
        res = _api(method, path, body)
        logger.info("command_center: organize %s %s ok=%s (%s)",
                    method, path, res is not None, why)


def _run_organize_jobs(jobs: list) -> None:
    """Process one chat batch (one or more organize jobs). Marks each
    job done/failed with its lease token."""
    for job in jobs:
        payload = job.get("payload") or {}
        try:
            actions = plan_organize_actions(payload)
            dry_run = _is_organize_dryrun(payload)
            _execute_organize_actions(actions, dry_run)
            logger.info(
                "command_center: organize job %s planned %d action(s)",
                job.get("id"), len(actions))
            if dry_run:
                logger.info("command_center: organize job %s dry-run, "
                            "skipping done ack", job.get("id"))
            else:
                _finish_job(job, True)
        except Exception as exc:
            logger.warning("command_center: organize job %s failed: %s",
                           job.get("id"), exc)
            if _is_organize_dryrun(payload):
                logger.info("command_center: organize job %s dry-run, "
                            "skipping failed ack", job.get("id"))
            else:
                _finish_job(job, False, str(exc)[:500])


def _finish_job(job: dict, ok: bool, error: str = "") -> None:
    route = "done" if ok else "failed"
    body = {"lease_token": job.get("lease_token") or ""}
    if not ok:
        body["error"] = error
    res = _api("POST", f"/api/agent/jobs/{job.get('id')}/{route}", body)
    logger.info("command_center: job %s (%s) %s ack=%s", job.get("id"),
                job.get("type"), route, res is not None)


# Per-chat quiet-period buffer: chat_id -> {"deadline": float, "jobs": [...] }
_organize_pending: dict = {}
_organize_lock = threading.Lock()


def _organize_chat_id(job: dict) -> str:
    p = job.get("payload") or {}
    chat = p.get("chat") or {}
    return str(chat.get("id") or p.get("chat_id") or "unknown")


def _buffer_organize_job(job: dict) -> None:
    cid = _organize_chat_id(job)
    with _organize_lock:
        entry = _organize_pending.setdefault(
            "unknown" if not cid else cid,
            {"deadline": 0.0, "jobs": []})
        entry["jobs"].append(job)
        # Newest queued job resets the 2-minute quiet period.
        entry["deadline"] = time.time() + ORGANIZE_QUIET_S
    logger.info("command_center: organize job %s buffered for chat %s "
                "(%d pending)", job.get("id"), cid,
                len(entry["jobs"]))


def _organize_sweeper() -> None:
    while True:
        try:
            time.sleep(10)
            now = time.time()
            due: list = []
            with _organize_lock:
                for cid in list(_organize_pending):
                    entry = _organize_pending[cid]
                    if entry["jobs"] and now >= entry["deadline"]:
                        due.append((cid, entry["jobs"]))
                        del _organize_pending[cid]
            for cid, jobs in due:
                logger.info("command_center: organize batch for chat %s "
                            "quiet, processing %d job(s)", cid, len(jobs))
                _run_organize_jobs(jobs)
        except Exception as exc:
            logger.warning("command_center: organize sweeper error: %s", exc)


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
        (_organize_sweeper, "cc-organize"),
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
                    if job.get("type") == "organize":
                        _buffer_organize_job(job)  # 2-min quiet batch (Goal 6)
                    else:
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
        elif job.get("type") == "cc-followups":
            _run_followups_job(job)  # deterministic, no LLM (Goal 9)
        elif job.get("type") == "draft":
            _run_draft_job(job)  # deterministic drafter, no LLM (Goal 8)
        _api("POST", f"/api/agent/jobs/{jid}/done", {})
        logger.info("command_center: job %s (%s) done", jid, job.get("type"))
    except Exception as exc:
        logger.warning("command_center: job %s failed: %s", jid, exc)
        _api("POST", f"/api/agent/jobs/{jid}/failed", {"error": str(exc)[:500]})


# ------------------------------------------------------------- drafter ---

def _run_draft_job(job: dict) -> None:
    """Process a draft job (Goal 8, cc-reply-drafter skill).

    Reads context via GET /api/agent/context?factoryProductId=..., runs the
    deterministic decideAction logic inline (no LLM — the logic lives in the
    dashboard's src/lib/cc/drafter.ts; this is a Python mirror), and creates
    a draft via POST /api/agent/drafts with bubbles + guardrail. The guardrail
    runs server-side on the drafts route; a blocked draft becomes a
    guardrail_block question, not a draft.
    """
    payload = job.get("payload") or {}
    fp = str(payload.get("factory_product_id", "") or payload.get("factoryProductId", ""))
    if not fp:
        logger.warning("command_center: draft job %s has no factory_product_id", job.get("id"))
        return

    # Fetch context from the Agent API.
    ctx_res = _api("GET", f"/api/agent/context?factoryProductId={fp}")
    if not ctx_res:
        logger.warning("command_center: draft job %s context fetch failed", job.get("id"))
        return

    # Read the latest inbound factory message from context.
    messages = ctx_res.get("messages") or []
    last_inbound = None
    for m in reversed(messages):
        if m.get("direction") == "in":
            last_inbound = m
            break
    if not last_inbound:
        logger.info("command_center: draft job %s no inbound message found, skipping", job.get("id"))
        return

    text = str(last_inbound.get("text", "") or "")
    msg_id = str(last_inbound.get("id", "") or "")
    chat_id = str(last_inbound.get("chat_id", "") or "")

    # Build context snapshot for decideAction.
    steps = ctx_res.get("steps") or {}
    ctx = {
        "step1Done": bool(steps.get("step1", {}).get("done")),
        "step2Done": bool(steps.get("step2", {}).get("done")),
        "step3Done": bool(steps.get("step3", {}).get("done")),
        "step4Done": bool(steps.get("step4", {}).get("done")),
        "specAnswers": [f.get("label", "") + ": " + f.get("value", "")
                        for f in (ctx_res.get("spec", {}).get("fields") or [])],
        "openChanges": len(ctx_res.get("adjustments") or []),
        "approach": str(ctx_res.get("approach") or "already_selling"),
    }

    result = _decide_action(text, ctx, fp, chat_id, msg_id)
    if result:
        logger.info("command_center: draft job %s -> %s (%s)",
                     job.get("id"), result.get("action"), result.get("note", ""))


def _decide_action(text, ctx, fp, chat_id, msg_id):
    """Python mirror of src/lib/cc/drafter.ts decideAction.

    Returns the draft body to POST, or None for 'none' actions.
    """
    import re as _re2

    ACK = _re2.compile(r"^(ok|okay|noted|received|thanks|thank you|got it|please wait|one moment|稍等|收到|好的)\W*$", _re2.I)
    GREET = _re2.compile(r"^(hi|hello|hey|good\s+(morning|afternoon|evening)|dear|你好|您好)[!.,\s]*$", _re2.I)
    EMOJI = _re2.compile(r"^[\U0001f000-\U0001f9ff\U00002600-\U000027bf\s]+$',", _re2.I)

    t = (text or "").strip()
    if not t or ACK.match(t) or GREET.match(t):
        return None
    if len(t) < 3 and not _re2.search(r"[a-z0-9\u4e00-\u9fff]", t, _re2.I):
        return None

    FEE = _re2.compile(r"sample\s+(fee|charge|cost)|fee\s+for.{0,20}sample|sample.{0,20}\$\s?\d|\$\s?\d.{0,20}sample", _re2.I)
    QUOTE = _re2.compile(r"\$\s?\d|USD|RMB|CNY|¥\s?\d|\bprice\b|\bquote\b|FOB|EXW|CIF|DDP", _re2.I)
    MOQ = _re2.compile(r"\bMOQ\b|minimum order|payment|T/T|L/C|deposit|wire transfer|invoice|paypal|alipay|volume|per month|per year", _re2.I)
    TRACKING = _re2.compile(r"\b(SF\d{10,}|\d{12,}|[A-Z]{2}\d{9}[A-Z]{2}|YT\d{10,})\b", _re2.I)
    CAN_MAKE = _re2.compile(r"we\s+can\s+(make|produce|do)|yes.{0,20}can\s+(make|do|produce)|no\s+problem.{0,20}(make|produce)|can\s+be\s+(made|produced)", _re2.I)
    SPEC_CONFIRM = _re2.compile(r"confirm.{0,20}spec|spec.{0,20}(confirmed|ok|okay|correct|no problem|looks good)|agree.{0,20}spec|make.{0,20}to\s+spec", _re2.I)
    SAMPLE_COMMIT = _re2.compile(r"will\s+send.{0,20}sample|send.{0,20}sample.{0,20}(tomorrow|soon|this week|next week)|sample.{0,20}(on the way|shipped|ready)", _re2.I)
    CHANGE = _re2.compile(r"\b(change|adjust|modify|revise|instead of|propose)\b|改|调整", _re2.I)
    FLEX = _re2.compile(r"carton|packing|packaging|color shade|label|bag", _re2.I)

    if FEE.search(t):
        _api("POST", "/api/agent/questions",
             {"factory_product_id": fp, "kind": "fee",
              "body": {"message_id": msg_id, "text": t[:500]}, "importance": "high"})
        return {"action": "fee", "note": "sample-fee"}

    if QUOTE.search(t):
        _api("POST", "/api/agent/quotes",
             {"factory_product_id": fp, "message_id": msg_id, "text": t[:500]})
        bubbles = [
            "Thanks for sharing this.",
            "What matters most to us right now is quality — could you send samples so we can review them against the spec?",
        ]
        return _post_draft(fp, chat_id, bubbles, "record-quote")

    if MOQ.search(t):
        _api("POST", "/api/agent/questions",
             {"factory_product_id": fp, "kind": "question",
              "body": {"issue": "order_terms", "message_id": msg_id, "text": t[:300]},
              "importance": "medium"})
        return {"action": "question", "note": "moq-payment-volume"}

    if TRACKING.search(t):
        trk = TRACKING.search(t).group(1)
        _api("POST", "/api/agent/steps",
             {"factory_product_id": fp, "step": 5, "proof_message_id": msg_id})
        _api("POST", "/api/agent/shipments",
             {"leg": "china_to_yiwu", "tracking_number": trk, "carrier": "", "status": "created"})
        return _post_draft(fp, chat_id,
                            ["Great, thanks for sending this over.",
                             "We'll watch for it and confirm once it arrives."],
                            f"tracking:{trk}")

    if SAMPLE_COMMIT.search(t):
        _api("POST", "/api/agent/steps",
             {"factory_product_id": fp, "step": 4, "proof_message_id": msg_id})
        return _post_draft(fp, chat_id,
                           ["Thanks for confirming.",
                            "Please share the tracking number once it ships so we can follow it."],
                           "step4-sample-tracking")

    if SPEC_CONFIRM.search(t) and ctx["openChanges"] == 0:
        if ctx["step3Done"]:
            return _post_draft(fp, chat_id,
                ["Great — glad the spec works.",
                 "Please send the sample to our China office: 浙江义乌稠城街道丹溪北路18号雪峰银座9楼912室 丁小姐 15067460724.",
                 "Our box to New York leaves soon, so sooner is better."],
                "step3-sample-request")
        else:
            return {"action": "question", "note": "spec-confirm-pre-step3"}

    if CAN_MAKE.search(t):
        _api("POST", "/api/agent/steps",
             {"factory_product_id": fp, "step": 2, "proof_message_id": msg_id})
        if ctx["openChanges"] > 0:
            return _post_draft(fp, chat_id,
                ["Good to hear you can make it.",
                 "There are still a couple of open spec points — can you confirm those match too?"],
                "step2-open-changes")
        return _post_draft(fp, chat_id,
            ["Good to hear you can make it.",
             "Can you confirm the spec matches exactly as attached?"],
            "step2-confirm")

    if CHANGE.search(t):
        if FLEX.search(t):
            return _post_draft(fp, chat_id,
                ["That works for us — close enough on this one.",
                 "Please include it in the sample."],
                "flexible-accepted")
        return _post_draft(fp, chat_id,
            ["Thanks for checking.",
             "We need to keep this one exactly to spec — can you make the sample as specified?"],
            "locked-decline")

    # Question the spec can answer vs spec gap
    if "?" in t:
        return _post_draft_or_question(fp, chat_id, t, ctx, msg_id)

    # Default: opener (if first contact) or a generic acknowledgment draft
    if not ctx["step1Done"]:
        return _post_draft(fp, chat_id,
            ["Hi, we import and sell this kind of product under AllSett Health, Refreshify, and Everlasting.",
             "We're adding another factory — can you make it to the attached spec?",
             "If so, please send samples to our China office."],
            "opener", attach_pdf=True)

    return None


def _post_draft(fp, chat_id, bubbles, reason, attach_pdf=False):
    body = {
        "factory_product_id": fp,
        "chat_id": chat_id,
        "kind": "reply",
        "reason": reason,
        "bubbles": bubbles,
        "source": "ai",
    }
    if attach_pdf:
        body["attach_pdf"] = True
    res = _api("POST", "/api/agent/drafts", body)
    logger.info("command_center: draft created for %s (%s) ok=%s", fp, reason, res is not None)
    return {"action": "draft", "note": reason}


def _post_draft_or_question(fp, chat_id, text, ctx, msg_id):
    spec_answers = ctx.get("specAnswers", [])
    for a in spec_answers:
        key = a.split(":")[0].strip().lower()
        if key and key in text.lower():
            return _post_draft(fp, chat_id, [a], "spec-answer")
    _api("POST", "/api/agent/questions",
         {"factory_product_id": fp, "kind": "question",
          "body": {"issue": "spec_gap", "message_id": msg_id, "text": text[:300]},
          "importance": "medium"})
    return {"action": "question", "note": "spec-gap"}


# --------------------------------------------------- followups (Goal 9) ---
# Deterministic follow-up processor (cc-followups skill). No LLM: the
# tick route already computed importance + sendAfter; the poller creates
# a follow-up draft (they_owe) or raises the question card (we_owe).

def _run_followups_job(job: dict) -> None:
    """Process a cc-followups job (Goal 9, SPEC §3.6).

    Payload: {factoryProductId, openItemId, importance, sendAfter, direction}
    - they_owe: create a follow-up draft via POST /api/agent/drafts with
      the send-timing buttons (kind: followup). The draft route runs the
      guardrail server-side.
    - we_owe: the tick route already raised the question card to High and
      notified Haim; the poller creates no factory draft.
    """
    payload = job.get("payload") or {}
    fp = str(payload.get("factoryProductId", "") or "")
    open_item_id = str(payload.get("openItemId", "") or "")
    importance = str(payload.get("importance", "Low") or "Low")
    send_after = payload.get("sendAfter", 0)
    direction = str(payload.get("direction", "they_owe") or "they_owe")

    if direction == "they_owe" and fp:
        # Build a short, warm, non-pushy follow-up. Never names a ship day.
        bubbles = [
            "Hi — just checking in on this.",
            "Could you let us know when you have an update?",
        ]
        body = {
            "factory_product_id": fp,
            "chat_id": "",  # resolved server-side from the product's chats
            "kind": "followup",
            "reason": f"§3.6 follow-up — overdue open item {open_item_id}",
            "bubbles": bubbles,
            "source": "ai",
        }
        res = _api("POST", "/api/agent/drafts", body)
        logger.info(
            "command_center: followups job %s created draft for %s "
            "(importance=%s) ok=%s",
            job.get("id"), fp, importance, res is not None,
        )
    else:
        # we_owe: no factory draft. The tick route already raised the
        # question card and notified Haim.
        logger.info(
            "command_center: followups job %s we_owe %s — no draft, "
            "question card already raised",
            job.get("id"), fp,
        )


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
                # Outbox claim returns {"outbox": row}; notifications {"notification": row}.
                row = (res or {}).get("outbox") or (res or {}).get("row") or (res or {}).get("notification")
                if not row:
                    continue
                _send_row(kind, row)
        except Exception as exc:
            logger.warning("command_center: outbox loop error: %s", exc)


def _send_row(kind: str, row: dict) -> None:
    rid = row.get("id")
    lease_token = row.get("lease_token") or ""
    try:
        # Prefer the bridge-routable external chat id (server-enriched); fall back to chat_id.
        chat_id = row.get("chat_external_id") or row.get("chat_id", "")
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
        _api("POST", f"/api/agent/{kind}/{rid}/sent", {"lease_token": lease_token, "external_message_ids": ids})
        logger.info("command_center: %s %s sent (%d bubbles)", kind, rid, len(ids))
    except Exception as exc:
        logger.warning("command_center: %s %s failed: %s", kind, rid, exc)
        _api("POST", f"/api/agent/{kind}/{rid}/failed", {"lease_token": lease_token, "error": str(exc)[:500]})


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
