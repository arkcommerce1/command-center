// Decision bridge (Goal 7): shared cores used by the dashboard approve route,
// POST /api/agent/approval-reply, and the fee/question answer endpoints.
// Pure functions over plain rows — no store imports, fully unit-testable.
// Callers persist the returned objects.
//
// Server guarantees (SPEC §1.3), enforced here before any write:
// - version must be the latest, draft must be pending, content hash must match;
// - exactly one outbox row per draft version (unique draft_version_id).

import { createHash } from "crypto";
import { nextBusinessSlot } from "@/lib/cc/china-time";

export type SendAfterChoice = "now" | "tomorrow" | "in3days";

export interface BridgeDraft {
  id: string;
  factoryProductId: string;
  status: string;
}

export interface BridgeVersion {
  id: string;
  draftId: string;
  versionNumber: number;
  text: string;
}

export interface BridgeOutboxRow {
  id?: string;
  draft_version_id: string;
  chat_id: string;
  bubbles: string[];
  status: string;
  send_after: number | null;
}

/** sha256 over the canonical JSON of the bubbles (matches agent drafts route). */
export function hashBubbles(bubbles: string[]): string {
  return createHash("sha256").update(JSON.stringify(bubbles)).digest("hex");
}

/** Split draft text into 1-4 WhatsApp bubbles on blank lines. */
export function textToBubbles(text: string): string[] {
  const parts = String(text || "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0 && String(text || "").trim()) return [String(text).trim()];
  return parts.slice(0, 4);
}

export interface QueueCheck {
  ok: true;
  bubbles: string[];
  contentHash: string;
}

export interface QueueRefusal {
  ok: false;
  code: "draft_not_pending" | "not_latest" | "hash_mismatch" | "already_queued" | "no_chat";
  message: string;
}

/**
 * Validate an approval before anything is written. Returns the exact bubbles
 * + hash to persist, or a refusal. latestVersionNumber is the max
 * versionNumber across the draft's versions.
 */
export function checkApprovable(input: {
  draft: BridgeDraft;
  version: BridgeVersion;
  latestVersionNumber: number;
  existingOutboxForVersion: number;
  expectedHash?: string;
}): QueueCheck | QueueRefusal {
  const { draft, version, latestVersionNumber, existingOutboxForVersion, expectedHash } = input;
  if (draft.status !== "pending") {
    return { ok: false, code: "draft_not_pending", message: `Draft is ${draft.status}, not pending` };
  }
  if (version.versionNumber !== latestVersionNumber) {
    return {
      ok: false,
      code: "not_latest",
      message: `There's a newer version (v${latestVersionNumber}). Check the dashboard.`,
    };
  }
  const bubbles = textToBubbles(version.text);
  if (bubbles.length === 0) {
    return { ok: false, code: "hash_mismatch", message: "Version has no sendable text" };
  }
  const contentHash = hashBubbles(bubbles);
  if (expectedHash && expectedHash !== contentHash) {
    return { ok: false, code: "hash_mismatch", message: "Content hash mismatch" };
  }
  if (existingOutboxForVersion > 0) {
    return { ok: false, code: "already_queued", message: "Already approved — nothing sent twice." };
  }
  return { ok: true, bubbles, contentHash };
}

/** Build the outbox row to insert (caller assigns id/persists). */
export function buildOutboxRow(input: {
  versionId: string;
  chatId: string;
  bubbles: string[];
  sendAfter: number | null;
}): BridgeOutboxRow {
  return {
    draft_version_id: input.versionId,
    chat_id: input.chatId,
    bubbles: [...input.bubbles],
    status: "queued",
    send_after: input.sendAfter,
  };
}

// --- follow-up send timing (SPEC §3.6: sends only in China business hours) ---

/** Resolve a send-timing choice to an epoch-ms send_after (null = now). */
export function sendAfterFor(choice: SendAfterChoice | number | null | undefined, nowMs = Date.now()): number | null {
  if (choice == null || choice === "now") return null;
  if (typeof choice === "number" && Number.isFinite(choice)) return choice;
  const cst = (d: Date) =>
    new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10); // CST calendar day
  const now = new Date(nowMs);
  const days = choice === "tomorrow" ? 1 : 3;
  // Target: 09:30 China time, days out.
  const cstDay = cst(new Date(nowMs + days * 24 * 3600 * 1000));
  const target = new Date(`${cstDay}T09:30:00+08:00`);
  const slot = nextBusinessSlot(target);
  void cst;
  void now;
  return slot.getTime();
}

// --- sample-fee @Yuki message (single source of truth) ---

export interface FeeBody {
  amount?: string | number | null;
  currency?: string | null;
  covers?: string | null;
  factory?: string | null;
  product?: string | null;
  factoryMessage?: string | null;
  /** Organizer-composed exact message wins when present. */
  yukiMessage?: string | null;
}

/**
 * The exact message posted when a fee card is approved. When the organizer
 * composed yukiMessage it is used verbatim; otherwise it is built from the
 * amount/currency/covers fields. Cards display resolveFeeMessage(body) and
 * approval queues resolveFeeMessage(body) — always the same string.
 */
export function resolveFeeMessage(body: FeeBody): string {
  if (body.yukiMessage && String(body.yukiMessage).trim()) return String(body.yukiMessage).trim();
  const amount = body.amount != null && String(body.amount).trim() ? String(body.amount).trim() : "?";
  const currency = body.currency ? ` ${String(body.currency).trim()}` : "";
  const who = body.factory ? ` to ${String(body.factory).trim()}` : "";
  const covers = body.covers ? ` Covers: ${String(body.covers).trim()}` : "";
  return `@Yuki can you pay the sample fee of ${amount}${currency}${who} from the China office?${covers}`.trim();
}

// --- Suggest-changes rewrite (template stub; Nous rewrite replaces this) ---

/**
 * Template-based rewrite for "Suggest changes". Applies explicit
 * replace "A" with "B" / "A" -> "B" instructions when present; otherwise keeps
 * the current text and records Haim's note as the last bubble so v2 always
 * differs from v1 and the word-level diff has something to highlight.
 * Returns the new full text. Recorded in docs/STACK.md: on-screen AI rewrite
 * via Nous is intentionally deferred; this stub is deterministic and offline.
 */
export function stubRewrite(currentText: string, suggestion: string): string {
  const cur = String(currentText || "");
  const sug = String(suggestion || "").trim();
  if (!sug) return cur;
  const m = sug.match(/replace\s+["“”'](.+?)["“”']\s+with\s+["“”'](.+?)["“”']/i) || sug.match(/["“”'](.+?)["“”']\s*->\s*["“”'](.+?)["“”']/);
  if (m) {
    const [from, to] = [m[1].trim(), m[2].trim()];
    if (from && to && cur.includes(from)) return cur.split(from).join(to);
  }
  const note = `Note for factory: ${sug}`;
  return cur.trim() ? `${cur.trim()}\n\n${note}` : note;
}

// --- word-level diff (for v2 highlight) ---

export type DiffToken = { t: "same" | "del" | "ins"; text: string };

function splitWords(s: string): string[] {
  return String(s || "")
    .split(/(\s+)/)
    .filter((w) => w.length > 0);
}

/**
 * Word-level diff via LCS on words (whitespace tokens included so rendering
 * preserves spacing). Deterministic, dependency-free.
 */
export function wordDiff(oldText: string, newText: string): DiffToken[] {
  const a = splitWords(oldText);
  const b = splitWords(newText);
  const n = a.length;
  const m = b.length;
  // LCS DP table (texts are short drafts; fine).
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? (dp[i + 1][j + 1] + 1) as number : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  const push = (t: DiffToken["t"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.t === t) last.text += text;
    else out.push({ t, text });
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", a[i]);
      i++;
    } else {
      push("ins", b[j]);
      j++;
    }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("ins", b[j++]);
  return out;
}
