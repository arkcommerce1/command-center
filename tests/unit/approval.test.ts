// Approval engine transitions (SPEC §1.3 server guarantees).
import { describe, expect, it } from "vitest";

import {
  ApprovalError,
  approve,
  claimOutbox,
  closeOnHumanReply,
  contentHash,
  createApprovalStore,
  createDraft,
  disapprove,
  markOutboxSent,
  markOutboxUncertain,
  suggest,
  updateOnNewMessage,
} from "@/lib/cc/approval";

function setup() {
  const store = createApprovalStore();
  const { draft, version } = createDraft(store, {
    factoryProductId: "fp1",
    chatId: "chat1",
    kind: "reply",
    bubbles: ["Hello, thanks for the update.", "Could you confirm the material?"],
  });
  return { store, draft, version };
}

describe("approval engine", () => {
  it("approves the latest pending version and creates exactly one outbox row", () => {
    const { store, draft, version } = setup();
    const { outbox } = approve(store, version.id);
    expect(draft.status).toBe("approved");
    expect(outbox.draftVersionId).toBe(version.id);
    expect(outbox.chatId).toBe("chat1");
    expect(outbox.bubbles).toEqual(version.bubbles);
    expect(outbox.status).toBe("queued");
    expect([...store.outbox.values()].filter((r) => r.draftVersionId === version.id)).toHaveLength(1);
  });

  it("refuses to approve an old version once a newer one exists", () => {
    const { store, version } = setup();
    suggest(store, version.draftId, "make it warmer", ["Hello, thanks!", "Could you confirm the material?"]);
    expect(() => approve(store, version.id)).toThrowError(ApprovalError);
    expect(() => approve(store, version.id)).toThrowError(/not the latest/);
    // The store is untouched: draft still pending, no outbox row.
    expect(store.drafts.get(version.draftId)?.status).toBe("pending");
    expect(store.outbox.size).toBe(0);
  });

  it("refuses approval on a content-hash mismatch", () => {
    const { store, version } = setup();
    version.bubbles[0] = "Tampered text nobody approved.";
    expect(() => approve(store, version.id)).toThrowError(/hash/i);
    expect(store.drafts.get(version.draftId)?.status).toBe("pending");
    expect(store.outbox.size).toBe(0);
  });

  it("refuses approval when the caller hash does not match", () => {
    const { store, version } = setup();
    expect(() => approve(store, version.id, { expectedHash: "deadbeef" })).toThrowError(/hash/i);
    expect(store.outbox.size).toBe(0);
  });

  it("refuses approval when the draft is no longer pending", () => {
    const { store, draft, version } = setup();
    disapprove(store, draft.id, "too pushy");
    expect(() => approve(store, version.id)).toThrowError(/not pending/);
    expect(store.outbox.size).toBe(0);
  });

  it("refuses a second pending draft for the same factory_product", () => {
    const { store } = setup();
    expect(() =>
      createDraft(store, { factoryProductId: "fp1", chatId: "chat1", kind: "reply", bubbles: ["Hi again."] }),
    ).toThrowError(/pending draft already exists/);
    // A different factory_product is fine.
    expect(() =>
      createDraft(store, { factoryProductId: "fp2", chatId: "chat2", kind: "reply", bubbles: ["Hi."] }),
    ).not.toThrow();
  });

  it("allows a new draft after the previous one was approved", () => {
    const { store, version } = setup();
    approve(store, version.id);
    expect(() =>
      createDraft(store, { factoryProductId: "fp1", chatId: "chat1", kind: "followup", bubbles: ["Follow up."] }),
    ).not.toThrow();
  });

  it("suggest creates a new version carrying the suggestion text", () => {
    const { store, draft, version } = setup();
    const v2 = suggest(store, draft.id, "mention the sample", ["Hello!", "Please send a sample."]);
    expect(v2.version).toBe(2);
    expect(v2.source).toBe("suggestion");
    expect(v2.suggestionText).toBe("mention the sample");
    expect(v2.contentHash).toBe(contentHash(["Hello!", "Please send a sample."]));
    expect(draft.currentVersion).toBe(2);
    // v1 can no longer be approved.
    expect(() => approve(store, version.id)).toThrowError(/not the latest/);
    // v2 approves cleanly.
    expect(approve(store, v2.id).outbox.status).toBe("queued");
  });

  it("disapprove closes the draft with the optional reason", () => {
    const { store, draft } = setup();
    disapprove(store, draft.id, "wrong tone");
    expect(draft.status).toBe("disapproved");
    expect(draft.disapproveReason).toBe("wrong tone");
  });

  it("disapprove without a reason stores null", () => {
    const { store, draft } = setup();
    disapprove(store, draft.id);
    expect(draft.disapproveReason).toBeNull();
  });

  it("closeOnHumanReply closes the pending draft on an Ours outbound not via outbox", () => {
    const { store, draft } = setup();
    const closed = closeOnHumanReply(store, { chatId: "chat1", senderType: "ours", fromOutbox: false });
    expect(closed?.id).toBe(draft.id);
    expect(draft.status).toBe("closed");
    expect(draft.closedReason).toBe("human_replied");
  });

  it("closeOnHumanReply ignores outbox sends and factory inbound", () => {
    const { store, draft } = setup();
    expect(closeOnHumanReply(store, { chatId: "chat1", senderType: "ours", fromOutbox: true })).toBeNull();
    expect(closeOnHumanReply(store, { chatId: "chat1", senderType: "factory", fromOutbox: false })).toBeNull();
    expect(draft.status).toBe("pending");
  });

  it("updateOnNewMessage adds a version marked update; only newest approves", () => {
    const { store, draft, version } = setup();
    const v2 = updateOnNewMessage(store, draft.id, ["Updated reply after factory message."]);
    expect(v2.source).toBe("update");
    expect(v2.version).toBe(2);
    expect(() => approve(store, version.id)).toThrowError(/not the latest/);
    expect(approve(store, v2.id).outbox.status).toBe("queued");
  });

  it("two concurrent outbox claims yield exactly one winner", () => {
    const { store, version } = setup();
    const { outbox } = approve(store, version.id);
    const now = Date.now();
    const wins = [claimOutbox(store, outbox.id, "lease-a", now), claimOutbox(store, outbox.id, "lease-b", now)];
    expect(wins.filter(Boolean)).toHaveLength(1);
    expect(outbox.status).toBe("sending");
  });

  it("an expired lease can be re-claimed, a live one cannot", () => {
    const { store, version } = setup();
    const { outbox } = approve(store, version.id);
    const now = Date.now();
    expect(claimOutbox(store, outbox.id, "lease-a", now, 1000)).toBe(true);
    expect(claimOutbox(store, outbox.id, "lease-b", now + 500, 1000)).toBe(false);
    expect(claimOutbox(store, outbox.id, "lease-c", now + 2000, 1000)).toBe(true);
  });

  it("only the lease holder can mark sent; double-send is refused", () => {
    const { store, version } = setup();
    const { outbox } = approve(store, version.id);
    const now = Date.now();
    expect(claimOutbox(store, outbox.id, "lease-a", now)).toBe(true);
    expect(() => markOutboxSent(store, outbox.id, "lease-b", ["mid1"])).toThrowError(/lease/i);
    markOutboxSent(store, outbox.id, "lease-a", ["mid1"]);
    expect(outbox.status).toBe("sent");
    expect(outbox.externalMessageIds).toEqual(["mid1"]);
    expect(claimOutbox(store, outbox.id, "lease-c", now)).toBe(false);
  });

  it("uncertain rows are never claimable again (never auto-resent)", () => {
    const { store, version } = setup();
    const { outbox } = approve(store, version.id);
    const now = Date.now();
    expect(claimOutbox(store, outbox.id, "lease-a", now)).toBe(true);
    markOutboxUncertain(store, outbox.id, "gateway restarted mid-send");
    expect(outbox.status).toBe("uncertain");
    expect(claimOutbox(store, outbox.id, "lease-b", now + 60_000)).toBe(false);
    expect(claimOutbox(store, outbox.id, "lease-c", now + 600_000)).toBe(false);
  });
});
