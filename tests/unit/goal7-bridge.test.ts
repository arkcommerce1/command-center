import { describe, expect, it } from "vitest";

import { APPROVAL_HELP, draftCodeFor, parseApprovalCode, resolveDraftCode } from "@/lib/cc/approval-codes";
import {
  checkApprovable,
  hashBubbles,
  resolveFeeMessage,
  sendAfterFor,
  stubRewrite,
  textToBubbles,
  wordDiff,
} from "@/lib/cc/decision-bridge";

describe("approval codes (Goal 7 WhatsApp shortcut)", () => {
  it("parses Y/N with version", () => {
    expect(parseApprovalCode("Y14.2")).toEqual({ action: "approve", draft: 14, version: 2 });
    expect(parseApprovalCode("n14.2")).toEqual({ action: "disapprove", draft: 14, version: 2 });
    expect(parseApprovalCode("  Y7  ")).toEqual({ action: "approve", draft: 7, version: null });
  });

  it("parses S with free text, with or without version", () => {
    expect(parseApprovalCode("S14 make it warmer")).toEqual({ action: "suggest", draft: 14, version: null, text: "make it warmer" });
    expect(parseApprovalCode("s14.2 use shorter bubbles")).toEqual({
      action: "suggest",
      draft: 14,
      version: 2,
      text: "use shorter bubbles",
    });
  });

  it("rejects non-codes", () => {
    expect(parseApprovalCode("ok thanks")).toEqual({ action: "unknown" });
    expect(parseApprovalCode("Y")).toEqual({ action: "unknown" });
    expect(parseApprovalCode("S14")).toEqual({ action: "unknown" });
    expect(APPROVAL_HELP).toMatch(/Y<draft>/);
  });

  it("resolves draft codes 1-based by creation time", () => {
    const drafts = [
      { id: "b", createdAt: 200 },
      { id: "a", createdAt: 100 },
      { id: "c", createdAt: 300 },
    ];
    expect(resolveDraftCode(drafts, 1)?.id).toBe("a");
    expect(resolveDraftCode(drafts, 3)?.id).toBe("c");
    expect(resolveDraftCode(drafts, 0)).toBeNull();
    expect(resolveDraftCode(drafts, 9)).toBeNull();
    expect(draftCodeFor(drafts, "b")).toBe(2);
    expect(draftCodeFor(drafts, "zzz")).toBeNull();
  });
});

describe("approvability guards (SPEC §1.3)", () => {
  const draft = { id: "d1", factoryProductId: "fp1", status: "pending" };
  const version = { id: "v1", draftId: "d1", versionNumber: 1, text: "Hello.\n\nThanks!" };

  it("approves latest pending with matching hash", () => {
    const r = checkApprovable({ draft, version, latestVersionNumber: 1, existingOutboxForVersion: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bubbles).toEqual(["Hello.", "Thanks!"]);
      expect(r.contentHash).toBe(hashBubbles(["Hello.", "Thanks!"]));
    }
  });

  it("refuses old versions, non-pending drafts, hash mismatch, duplicates", () => {
    expect(checkApprovable({ draft, version, latestVersionNumber: 2, existingOutboxForVersion: 0 })).toMatchObject({
      ok: false,
      code: "not_latest",
    });
    expect(
      checkApprovable({ draft: { ...draft, status: "sent" }, version, latestVersionNumber: 1, existingOutboxForVersion: 1 }),
    ).toMatchObject({ ok: false, code: "draft_not_pending" });
    expect(
      checkApprovable({ draft, version, latestVersionNumber: 1, existingOutboxForVersion: 0, expectedHash: "deadbeef" }),
    ).toMatchObject({ ok: false, code: "hash_mismatch" });
    expect(checkApprovable({ draft, version, latestVersionNumber: 1, existingOutboxForVersion: 1 })).toMatchObject({
      ok: false,
      code: "already_queued",
    });
  });

  it("splits text into at most 4 bubbles", () => {
    expect(textToBubbles("a\n\nb\n\nc\n\nd\n\ne")).toEqual(["a", "b", "c", "d"]);
    expect(textToBubbles("  ")).toEqual([]);
  });
});

describe("fee @Yuki message (single source of truth)", () => {
  it("uses the organizer-composed message verbatim", () => {
    expect(resolveFeeMessage({ yukiMessage: " @Yuki pay $20 please " })).toBe("@Yuki pay $20 please");
  });

  it("builds a fallback from amount/currency/covers", () => {
    const m = resolveFeeMessage({ amount: "200", currency: "RMB", covers: "3 samples", factory: "ABC" });
    expect(m).toContain("@Yuki");
    expect(m).toContain("200");
    expect(m).toContain("RMB");
  });
});

describe("suggest rewrite stub + word diff", () => {
  it("applies explicit replace instructions", () => {
    expect(stubRewrite("Hello world", 'replace "world" with "factory"')).toBe("Hello factory");
    expect(stubRewrite("Hello world", '"world" -> "there"')).toBe("Hello there");
  });

  it("appends the note when no explicit replacement", () => {
    const out = stubRewrite("Hello.", "make it warmer");
    expect(out).toContain("Hello.");
    expect(out).toContain("make it warmer");
    expect(out).not.toBe("Hello.");
  });

  it("diffs words with ins/del highlights", () => {
    const tokens = wordDiff("Hello world", "Hello factory");
    expect(tokens.some((t) => t.t === "del" && t.text.includes("world"))).toBe(true);
    expect(tokens.some((t) => t.t === "ins" && t.text.includes("factory"))).toBe(true);
    expect(wordDiff("same", "same").every((t) => t.t === "same")).toBe(true);
  });
});

describe("follow-up send timing", () => {
  it("now/null passes through as null (send immediately)", () => {
    expect(sendAfterFor("now")).toBeNull();
    expect(sendAfterFor(null)).toBeNull();
    expect(sendAfterFor(12345)).toBe(12345);
  });

  it("tomorrow resolves to 09:30 China time on a business day", () => {
    // Monday 2026-09-14 10:00 UTC = 18:00 CST.
    const nowMs = Date.UTC(2026, 8, 14, 10, 0, 0);
    expect(sendAfterFor("tomorrow", nowMs)).toBe(new Date("2026-09-15T09:30:00+08:00").getTime());
  });
});
