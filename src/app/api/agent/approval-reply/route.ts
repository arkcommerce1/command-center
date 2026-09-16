import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { approveDraftVersion } from "@/lib/cc/approve-flow";
import { APPROVAL_HELP, parseApprovalCode, resolveDraftCode } from "@/lib/cc/approval-codes";
import { stubRewrite } from "@/lib/cc/decision-bridge";
import { checkGuardrail } from "@/lib/cc/guardrail";
import { getDraft, listDrafts, listDraftVersions, saveDraft, saveDraftVersion } from "@/lib/cc/store";
import { DraftVersion, uid } from "@/lib/cc/types";

export const dynamic = "force-dynamic";

// POST /api/agent/approval-reply — Haim's WhatsApp shortcut (Goal 7).
// Body: { text: "Y14.2" | "N14.2" | "S14 <changes>", from?: string }.
// Same guards as the dashboard (latest-only, pending, hash, exactly one
// outbox row). Replies to old versions get the newer-version message;
// double-approves get already-approved without resending.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z.object({ text: z.string().min(1), from: z.string().optional().default("") }).safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });

  const code = parseApprovalCode(parsed.data.text);
  if (code.action === "unknown") {
    return NextResponse.json({ action: "unknown", message: APPROVAL_HELP });
  }

  const drafts = await listDrafts();
  const draft = resolveDraftCode(drafts, code.draft);
  if (!draft) {
    return NextResponse.json({ action: "not_found", message: `No draft D${code.draft}. Check the dashboard.` });
  }
  const versions = await listDraftVersions(draft.id);
  if (versions.length === 0) {
    return NextResponse.json({ action: "not_found", message: `Draft D${code.draft} has no versions.` });
  }
  const latestNumber = versions.reduce((m, v) => Math.max(m, v.versionNumber), 0);
  const latest = versions.find((v) => v.versionNumber === latestNumber)!;

  if (code.action === "approve") {
    const targetNumber = code.version ?? latestNumber;
    if (targetNumber !== latestNumber) {
      return NextResponse.json({
        action: "newer_version",
        draftId: draft.id,
        latestVersion: latestNumber,
        message: `There's a newer version (v${latestNumber}). Check the dashboard.`,
      });
    }
    const result = await approveDraftVersion({
      draftId: draft.id,
      versionNumber: targetNumber,
      channel: "whatsapp",
      approver: parsed.data.from || "haim",
    });
    if (!result.ok) {
      if (result.code === "not_latest") {
        return NextResponse.json({
          action: "newer_version",
          draftId: draft.id,
          latestVersion: result.latestVersionNumber,
          message: result.message,
        });
      }
      if (result.code === "draft_not_pending") {
        return NextResponse.json({ action: "already_closed", draftId: draft.id, message: result.message });
      }
      return NextResponse.json({ action: "refused", code: result.code, message: result.message }, { status: result.httpStatus });
    }
    if (result.alreadyApproved) {
      return NextResponse.json({ action: "already_approved", draftId: draft.id, message: "Already approved — nothing sent twice." });
    }
    return NextResponse.json({
      action: "approved",
      draftId: draft.id,
      version: result.version.versionNumber,
      outboxId: result.outbox.id,
      message: `Approved D${code.draft}.${result.version.versionNumber}. Queued to send.`,
    });
  }

  if (code.action === "disapprove") {
    const targetNumber = code.version ?? latestNumber;
    if (targetNumber !== latestNumber) {
      return NextResponse.json({
        action: "newer_version",
        draftId: draft.id,
        latestVersion: latestNumber,
        message: `There's a newer version (v${latestNumber}). Check the dashboard.`,
      });
    }
    const d = await getDraft(draft.id);
    if (!d || d.status !== "pending") {
      return NextResponse.json({ action: "already_closed", draftId: draft.id, message: `Draft is ${d?.status || "gone"}.` });
    }
    d.status = "disapproved";
    await saveDraft(d);
    const v = versions.find((x) => x.versionNumber === targetNumber)!;
    v.status = "disapproved";
    await saveDraftVersion(v);
    return NextResponse.json({ action: "disapproved", draftId: draft.id, message: `Disapproved D${code.draft}.${targetNumber}.` });
  }

  // suggest: new version via the same template rewrite as the dashboard.
  const d = await getDraft(draft.id);
  if (!d || d.status !== "pending") {
    return NextResponse.json({ action: "already_closed", draftId: draft.id, message: `Draft is ${d?.status || "gone"}.` });
  }
  if (code.version != null && code.version !== latestNumber) {
    return NextResponse.json({
      action: "newer_version",
      draftId: draft.id,
      latestVersion: latestNumber,
      message: `There's a newer version (v${latestNumber}). Check the dashboard.`,
    });
  }
  const text = stubRewrite(latest.text, code.text);
  const v: DraftVersion = {
    id: uid(),
    draftId: draft.id,
    versionNumber: latestNumber + 1,
    text,
    createdBy: "ai_suggestion",
    suggestionText: code.text.slice(0, 2000),
    basedOnVersion: latestNumber,
    guardrailResult: checkGuardrail(text),
    status: "pending",
    approvalChannel: null,
    approver: null,
    approvedAt: null,
    sentAt: null,
    disapproveReason: null,
    chatMovedOn: false,
    createdAt: Date.now(),
  };
  await saveDraftVersion(v);
  return NextResponse.json({
    action: "suggested",
    draftId: draft.id,
    version: v.versionNumber,
    message: `Saved as v${v.versionNumber}. Check the dashboard.`,
  });
}
