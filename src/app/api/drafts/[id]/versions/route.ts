import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { checkGuardrail } from "@/lib/cc/guardrail";
import { getDraft, listDraftVersions, saveDraftVersion } from "@/lib/cc/store";
import { DraftVersion, DraftVersionCreatedBy, uid } from "@/lib/cc/types";
import { stubRewrite } from "@/lib/cc/decision-bridge";
import { dbFind, dbInsert, dbUpdate } from "@/lib/cc/agent-store";
import { saveLesson, saveLearnedRule, extractRule, saveDraftExample } from "@/lib/cc/learning";

const CREATED_BY: DraftVersionCreatedBy[] = ["agent", "ai_suggestion", "haim"];

// GET /api/drafts/[id]/versions — list versions for a draft, oldest first.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: "draft not found" }, { status: 404 });
  return NextResponse.json(await listDraftVersions(id));
}

// POST /api/drafts/[id]/versions — create a new version.
// Goal 3: Saves a lesson record with the suggestion text as feedback.
// Goal 4: Extracts a rule from the feedback and saves it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Try dashboard store first, then agent store.
  let draft: any = await getDraft(id);
  let useAgent = false;
  if (!draft) {
    const agentDrafts = await dbFind("drafts", (d: any) => d.id === id);
    draft = agentDrafts[0] || null;
    if (draft) useAgent = true;
  }
  if (!draft) return NextResponse.json({ error: "draft not found" }, { status: 404 });
  if (draft.status !== "pending") {
    return NextResponse.json({ error: `Draft is ${draft.status}, not pending` }, { status: 422 });
  }

  const b = await req.json();
  const suggestionText = b.suggestionText != null ? String(b.suggestionText).slice(0, 2000) : null;
  let text = String(b.text || "");

  // Get existing versions from the right store.
  let existing: any[];
  if (useAgent) {
    existing = await dbFind("draftVersions", (v: any) => v.draft_id === id);
  } else {
    existing = await listDraftVersions(id);
  }

  if (!text.trim() && suggestionText && suggestionText.trim()) {
    const latest = existing.reduce((m, v) => ((v.versionNumber || v.version || 0) > (m?.versionNumber || m?.version || 0) ? v : m), existing[0]);
    const latestText = latest?.text || (latest?.bubbles || []).join("\n") || "";
    text = stubRewrite(latestText, suggestionText);
  }
  if (!text.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });

  const nextVersionNumber = existing.reduce((m, v) => Math.max(m, v.versionNumber || v.version || 0), 0) + 1;
  const createdBy: DraftVersionCreatedBy = CREATED_BY.includes(b.createdBy) ? b.createdBy : "agent";

  if (useAgent) {
    // Save to agent store.
    const newVersion = {
      id: uid(),
      draft_id: id,
      version: nextVersionNumber,
      versionNumber: nextVersionNumber,
      text,
      bubbles: text.split(/\n\s*\n/).map((s: string) => s.trim()).filter(Boolean),
      source: createdBy,
      suggestionText,
      status: "pending",
      approvalChannel: null,
      approver: null,
      approvedAt: null,
      sentAt: null,
      disapproveReason: null,
      guardrailResult: checkGuardrail(text),
      createdAt: Date.now(),
    };
    await dbInsert("draftVersions", newVersion);

    // Save lesson for the suggestion.
    if (suggestionText) {
      try {
        const allAgentVersions = await dbFind("draftVersions", (v: any) => v.draft_id === id);
        const firstVersion = allAgentVersions.sort((a: any, bb: any) => (a.versionNumber || a.version || 0) - (bb.versionNumber || bb.version || 0))[0];
        const aiDraft = firstVersion?.text || (firstVersion?.bubbles || []).join("\n") || null;
        const fp = (draft as any).factoryProductId || (draft as any).factory_product_id || null;
        const messages = fp ? await dbFind("messages", (m: any) => m.factory_product_id === fp && m.direction === "in") : [];
        const lastInbound = messages.sort((a: any, bb: any) => (Number(bb.sent_at) || 0) - (Number(a.sent_at) || 0))[0];

        const lesson = await saveLesson({
          action: "suggested",
          draftId: id,
          versionId: newVersion.id,
          factoryProductId: fp,
          factoryName: null,
          productName: null,
          incomingMessage: lastInbound?.text || null,
          aiDraft,
          feedbackText: suggestionText,
          finalSentText: null,
          step: null,
        });

        const ruleText = extractRule(suggestionText, null);
        if (ruleText) {
          await saveLearnedRule(ruleText, "all", null, null, suggestionText, lesson.id);
        }
      } catch {
        // Don't fail the version creation if lesson-saving fails.
      }
    }

    return NextResponse.json(newVersion);
  }

  // Dashboard store path (original logic).
  const v: DraftVersion = {
    id: uid(),
    draftId: id,
    versionNumber: nextVersionNumber,
    text,
    createdBy,
    suggestionText,
    basedOnVersion: typeof b.basedOnVersion === "number" ? b.basedOnVersion : null,
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

  // Goal 3: Save a lesson record for the suggestion.
  if (suggestionText) {
    try {
      const allAgentVersions = await dbFind("draftVersions", (vv: any) => vv.draftId === id || vv.draft_id === id);
      const firstVersion = allAgentVersions.sort((a: any, bb: any) => (a.versionNumber || a.version || 0) - (bb.versionNumber || bb.version || 0))[0];
      const aiDraft = firstVersion?.text || (firstVersion?.bubbles || []).join("\n") || null;
      const fp = (draft as any).factoryProductId || (draft as any).factory_product_id || null;
      const messages = fp ? await dbFind("messages", (m: any) => m.factory_product_id === fp && m.direction === "in") : [];
      const lastInbound = messages.sort((a: any, bb: any) => (Number(bb.sent_at) || 0) - (Number(a.sent_at) || 0))[0];

      const lesson = await saveLesson({
        action: "suggested",
        draftId: id,
        versionId: v.id,
        factoryProductId: fp,
        factoryName: null,
        productName: null,
        incomingMessage: lastInbound?.text || null,
        aiDraft,
        feedbackText: suggestionText,
        finalSentText: null,
        step: null,
      });

      const ruleText = extractRule(suggestionText, null);
      if (ruleText) {
        await saveLearnedRule(ruleText, "all", null, null, suggestionText, lesson.id);
      }
    } catch {
      // Don't fail the version creation if lesson-saving fails.
    }
  }

  return NextResponse.json(v);
}
