import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { checkGuardrail } from "@/lib/cc/guardrail";
import { getDraft, listDraftVersions, saveDraftVersion } from "@/lib/cc/store";
import { DraftVersion, DraftVersionCreatedBy, uid } from "@/lib/cc/types";
import { stubRewrite } from "@/lib/cc/decision-bridge";
import { dbFind } from "@/lib/cc/agent-store";
import { saveLesson, saveLearnedRule, extractRule, saveDraftExample } from "@/lib/cc/learning";

const CREATED_BY: DraftVersionCreatedBy[] = ["agent", "ai_suggestion", "haim"];

// GET /api/drafts/[id]/versions — list versions for a draft, oldest first.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: "draft not found" }, { status: 404 });
  return NextResponse.json(await listDraftVersions(id));
}

// POST /api/drafts/[id]/versions — create a new version. guardrailResult is ALWAYS
// computed server-side from the submitted text; any client-supplied guardrailResult is ignored.
// Suggest-changes flow: { suggestionText } without text rewrites the latest
// version server-side (template stub; see decision-bridge.stubRewrite) and
// saves the suggestion text on the new version.
//
// Goal 3: Saves a lesson record with the suggestion text as feedback.
// Goal 4: Extracts a rule from the feedback and saves it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: "draft not found" }, { status: 404 });
  if (draft.status !== "pending") {
    return NextResponse.json({ error: `Draft is ${draft.status}, not pending` }, { status: 422 });
  }
  const b = await req.json();
  const suggestionText = b.suggestionText != null ? String(b.suggestionText).slice(0, 2000) : null;
  let text = String(b.text || "");
  if (!text.trim() && suggestionText && suggestionText.trim()) {
    const existing = await listDraftVersions(id);
    const latest = existing.reduce((m, v) => (v && v.versionNumber > (m?.versionNumber || 0) ? v : m), existing[0]);
    text = stubRewrite(latest?.text || "", suggestionText);
  }
  if (!text.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });

  const existing = await listDraftVersions(id);
  const nextVersionNumber = existing.reduce((m, v) => Math.max(m, v.versionNumber), 0) + 1;
  const createdBy: DraftVersionCreatedBy = CREATED_BY.includes(b.createdBy) ? b.createdBy : "agent";

  const v: DraftVersion = {
    id: uid(),
    draftId: id,
    versionNumber: nextVersionNumber,
    text,
    createdBy,
    suggestionText,
    basedOnVersion: typeof b.basedOnVersion === "number" ? b.basedOnVersion : null,
    guardrailResult: checkGuardrail(text), // never trust client input for this
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
      // Get the first version (AI's original draft).
      const allAgentVersions = await dbFind("draftVersions", (vv: any) => vv.draftId === id);
      const firstVersion = allAgentVersions.sort((a: any, bb: any) => a.versionNumber - bb.versionNumber)[0];
      const aiDraft = firstVersion?.text || null;

      // Get the incoming message.
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
        finalSentText: null, // not sent yet — will be updated when the suggested version is approved
        step: null,
      });

      // Goal 4: Try to extract a rule from the suggestion text.
      const ruleText = extractRule(suggestionText, null);
      if (ruleText) {
        // Determine scope: if the feedback mentions a factory name, scope to that factory.
        // For now, default to all-factory scope unless we can detect a factory name.
        await saveLearnedRule(ruleText, "all", null, null, suggestionText, lesson.id);
      }
    } catch {
      // Don't fail the version creation if lesson-saving fails.
    }
  }

  return NextResponse.json(v);
}
