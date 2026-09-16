// Haim's WhatsApp approval codes (SPEC Goal 7).
// Each new card gets a DM with a code like D14.2 (draft 14, version 2).
// Haim replies: Y14.2 approve, N14.2 disapprove, S14 <text> suggest changes.
// Draft numbers are the 1-based index of drafts sorted by creation time
// (oldest = 1); drafts are never deleted, so codes stay stable.
// Pure module: no DB imports, fully unit-testable.

export type ApprovalCode =
  | { action: "approve"; draft: number; version: number | null }
  | { action: "disapprove"; draft: number; version: number | null }
  | { action: "suggest"; draft: number; version: number | null; text: string }
  | { action: "unknown" };

/** Parse one DM line into an approval code. Case-insensitive. */
export function parseApprovalCode(text: string): ApprovalCode {
  const t = (text || "").trim();
  let m = t.match(/^([YN])\s*(\d+)(?:\.(\d+))?\s*$/i);
  if (m) {
    return {
      action: m[1].toUpperCase() === "Y" ? "approve" : "disapprove",
      draft: Number(m[2]),
      version: m[3] != null ? Number(m[3]) : null,
    };
  }
  m = t.match(/^S\s*(\d+)(?:\.(\d+))?\s+([\s\S]+)$/i);
  if (m && m[3].trim()) {
    return { action: "suggest", draft: Number(m[1]), version: m[2] != null ? Number(m[2]) : null, text: m[3].trim() };
  }
  return { action: "unknown" };
}

/** Quick check used by the plugin: is this DM line an approval code? */
export function looksLikeApprovalCode(text: string): boolean {
  return parseApprovalCode(text).action !== "unknown";
}

/** Resolve a numeric draft code to a draft id. 1-based by creation time. */
export function resolveDraftCode<T extends { id: string; createdAt: number }>(drafts: T[], code: number): T | null {
  if (!Number.isInteger(code) || code < 1) return null;
  const sorted = [...drafts].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return sorted[code - 1] ?? null;
}

/** The 1-based code for a draft id (for DMs and the dashboard UI). */
export function draftCodeFor<T extends { id: string; createdAt: number }>(drafts: T[], id: string): number | null {
  const sorted = [...drafts].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const i = sorted.findIndex((d) => d.id === id);
  return i < 0 ? null : i + 1;
}

/** Short help text sent back when a code can't be parsed. */
export const APPROVAL_HELP =
  "Send Y<draft>.<version> to approve (e.g. Y14.2), N<draft>.<version> to disapprove, or S<draft> <what to change> to suggest changes.";
