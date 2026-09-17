// Shared approve flow (Goal 7): used by both the dashboard approve route and
// POST /api/agent/approval-reply, so dashboard and WhatsApp always apply the
// same guards and produce the same state. Writes dashboard store (draft +
// versions) and agent-store (exactly one outbox row the poller sends).
import { dbFind, dbInsert, dbUpdate } from "@/lib/cc/agent-store";
import { draftCodeFor } from "@/lib/cc/approval-codes";
import {
  buildOutboxRow,
  checkApprovable,
  sendAfterFor,
  SendAfterChoice,
} from "@/lib/cc/decision-bridge";
import { getDraft, getDraftVersion, listDrafts, listDraftVersions, saveDraft, saveDraftVersion } from "@/lib/cc/store";
import { ApprovalChannel } from "@/lib/cc/types";

export type ApproveResult =
  | { ok: true; draft: any; version: any; outbox: any; code: string | null; alreadyApproved: boolean }
  | { ok: false; httpStatus: number; code: string; message: string; latestVersionNumber?: number };

/** Resolve the agent-store chat for a dashboard draft via annotated messages. */
export async function resolveChatId(factoryProductId: string): Promise<string | null> {
  const msgs = await dbFind("messages", (m: any) => m.factory_product_id === factoryProductId && m.chat_id);
  if (msgs.length === 0) return null;
  msgs.sort((a: any, b: any) => (Number(b.sent_at) || 0) - (Number(a.sent_at) || 0));
  return msgs[0].chat_id as string;
}

// Agent-store draft helpers (used as fallback when dashboard store has no draft).
async function getAgentDraft(id: string): Promise<any | null> {
  const drafts = await dbFind("drafts", (d: any) => d.id === id);
  return drafts[0] || null;
}

async function listAgentDraftVersions(draftId: string): Promise<any[]> {
  return dbFind("draftVersions", (v: any) => v.draft_id === draftId);
}

async function saveAgentDraft(draft: any): Promise<void> {
  await dbUpdate("drafts", draft.id, { status: draft.status });
}

async function saveAgentDraftVersion(version: any): Promise<void> {
  await dbUpdate("draftVersions", version.id, {
    status: version.status,
    approvalChannel: version.approvalChannel,
    approver: version.approver,
    approvedAt: version.approvedAt,
    sentAt: version.sentAt,
    disapproveReason: version.disapproveReason,
  });
}

export async function approveDraftVersion(input: {
  draftId: string;
  versionId?: string;
  versionNumber?: number;
  channel: ApprovalChannel;
  approver: string;
  sendAfter?: SendAfterChoice | number | null;
  expectedHash?: string;
}): Promise<ApproveResult> {
  // Try dashboard store first, then agent store.
  let draft: any = await getDraft(input.draftId);
  let useAgentStore = false;
  if (!draft) {
    draft = await getAgentDraft(input.draftId);
    if (draft) useAgentStore = true;
  }
  if (!draft) return { ok: false, httpStatus: 404, code: "draft_not_found", message: "draft not found" };

  let allVersions: any[];
  if (useAgentStore) {
    allVersions = await listAgentDraftVersions(input.draftId);
  } else {
    allVersions = await listDraftVersions(input.draftId);
  }
  if (allVersions.length === 0) {
    return { ok: false, httpStatus: 404, code: "version_not_found", message: "version not found" };
  }
  const latestNumber = allVersions.reduce((m, v) => Math.max(m, v.versionNumber || v.version || 0), 0);
  let version = input.versionId
    ? (useAgentStore
        ? allVersions.find((v) => v.id === input.versionId) ?? null
        : await getDraftVersion(input.versionId))
    : allVersions.find((v) => (v.versionNumber || v.version) === (input.versionNumber ?? latestNumber)) ?? null;
  if (!version || (version.draftId || version.draft_id) !== input.draftId) {
    return { ok: false, httpStatus: 404, code: "version_not_found", message: "version not found" };
  }

  const now = Date.now();
  const existingOutbox = await dbFind("outbox", (x: any) => x.draft_version_id === version!.id);

  // Double-approve (dashboard re-click or WhatsApp Y after dashboard approve):
  // report already-approved, never resend.
  if (draft.status !== "pending" && existingOutbox.length > 0) {
    return { ok: true, draft, version, outbox: existingOutbox[0], code: null, alreadyApproved: true };
  }

  const fpId = draft.factoryProductId || draft.factory_product_id || null;
  const vText = version.text || (version.bubbles || []).join("\n");
  const vNum = version.versionNumber || version.version || 1;

  const check = checkApprovable({
    draft: { id: draft.id, factoryProductId: fpId, status: draft.status },
    version: { id: version.id, draftId: input.draftId, versionNumber: vNum, text: vText },
    latestVersionNumber: latestNumber,
    existingOutboxForVersion: existingOutbox.length,
    expectedHash: input.expectedHash,
  });
  if (!check.ok) {
    const httpStatus = check.code === "not_latest" || check.code === "already_queued" ? 409 : 422;
    return { ok: false, httpStatus, code: check.code, message: check.message, latestVersionNumber: latestNumber };
  }
  // not_latest doubles as the "reply to an old version" signal for WhatsApp.
  if (version.versionNumber !== latestNumber) {
    return {
      ok: false,
      httpStatus: 409,
      code: "not_latest",
      message: `There's a newer version (v${latestNumber}). Check the dashboard.`,
      latestVersionNumber: latestNumber,
    };
  }

  const chatId = await resolveChatId(fpId || "");
  if (!chatId) {
    return { ok: false, httpStatus: 409, code: "no_chat", message: "no chat found for this draft; cannot queue send" };
  }

  let outbox = existingOutbox[0];
  if (!outbox) {
    try {
      outbox = await dbInsert(
        "outbox",
        buildOutboxRow({ versionId: version.id, chatId, bubbles: check.bubbles, sendAfter: sendAfterFor(input.sendAfter, now) }),
      );
    } catch {
      // Lost a race with a concurrent approver: report already-approved.
      const raced = await dbFind("outbox", (x: any) => x.draft_version_id === version!.id);
      if (raced.length > 0) return { ok: true, draft, version, outbox: raced[0], code: null, alreadyApproved: true };
      throw new Error("outbox insert failed");
    }
  }

  version.status = "approved";
  version.approvalChannel = input.channel;
  version.approver = input.approver;
  version.approvedAt = now;
  version.sentAt = now;
  if (useAgentStore) {
    await saveAgentDraftVersion(version);
  } else {
    await saveDraftVersion(version);
  }

  // Replace other pending versions
  for (const other of allVersions) {
    if (other.id === version.id) continue;
    if (other.status === "pending") {
      other.status = "replaced";
      if (useAgentStore) {
        await saveAgentDraftVersion(other);
      } else {
        await saveDraftVersion(other);
      }
    }
  }

  draft.status = "sent";
  if (useAgentStore) {
    await saveAgentDraft(draft);
  } else {
    await saveDraft(draft);
  }

  const allDrafts = await listDrafts();
  const n = draftCodeFor(allDrafts, draft.id);
  return {
    ok: true,
    draft,
    version,
    outbox,
    code: n != null ? `D${n}.${vNum}` : null,
    alreadyApproved: false,
  };
}
