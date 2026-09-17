import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getDraft, getDraftVersion, saveDraft, saveDraftVersion } from "@/lib/cc/store";
import { dbFind, dbUpdate } from "@/lib/cc/agent-store";
import { saveLesson, saveLearnedRule, extractRule } from "@/lib/cc/learning";

// POST /api/drafts/[id]/versions/[vid]/disapprove  body: { reason?: string }
// The reason is optional and one line; it's saved as a style example source.
// Goal 3: Also saves a lesson record with the disapprove reason as feedback.
// Goal 4: If the reason can be extracted as a rule, saves it as an all-factory rule.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  const { id, vid } = await params;

  // Try dashboard store first, then agent store.
  let draft: any = await getDraft(id);
  let useAgent = false;
  if (!draft) {
    const agentDrafts = await dbFind("drafts", (d: any) => d.id === id);
    draft = agentDrafts[0] || null;
    if (draft) useAgent = true;
  }
  if (!draft) return NextResponse.json({ error: "draft not found" }, { status: 404 });

  let version: any = null;
  if (useAgent) {
    const agentVersions = await dbFind("draftVersions", (v: any) => v.id === vid && v.draft_id === id);
    version = agentVersions[0] || null;
  } else {
    version = await getDraftVersion(vid);
  }
  if (!version) return NextResponse.json({ error: "version not found" }, { status: 404 });
  if (draft.status !== "pending") {
    return NextResponse.json({ error: `Draft is ${draft.status}, not pending` }, { status: 422 });
  }

  const b = await req.json().catch(() => ({}) as any);
  const reason = String(b?.reason || "").replace(/\s+/g, " ").trim().slice(0, 140) || null;

  version.status = "disapproved";
  version.disapproveReason = reason;
  if (useAgent) {
    await dbUpdate("draftVersions", vid, { status: "disapproved", disapproveReason: reason });
  } else {
    await saveDraftVersion(version);
  }

  draft.status = "disapproved";
  if (useAgent) {
    await dbUpdate("drafts", id, { status: "disapproved" });
  } else {
    await saveDraft(draft);
  }

  // Goal 3: Save a lesson record.
  try {
    const allAgentVersions = useAgent
      ? await dbFind("draftVersions", (v: any) => v.draft_id === id)
      : await dbFind("draftVersions", (v: any) => v.draft_id === id);
    const firstVersion = allAgentVersions.sort((a: any, bb: any) => (a.versionNumber || a.version || 0) - (bb.versionNumber || bb.version || 0))[0];
    const aiDraft = firstVersion?.text || (firstVersion?.bubbles || []).join("\n") || null;

    const fp = (draft as any).factoryProductId || (draft as any).factory_product_id || null;
    const messages = fp ? await dbFind("messages", (m: any) => m.factory_product_id === fp && m.direction === "in") : [];
    const lastInbound = messages.sort((a: any, bb: any) => (Number(bb.sent_at) || 0) - (Number(a.sent_at) || 0))[0];

    const lesson = await saveLesson({
      action: "disapproved",
      draftId: id,
      versionId: vid,
      factoryProductId: fp,
      factoryName: null,
      productName: null,
      incomingMessage: lastInbound?.text || null,
      aiDraft,
      feedbackText: reason,
      finalSentText: null,
      step: null,
    });

    // Goal 4: Try to extract a rule from the disapprove reason.
    if (reason) {
      const ruleText = extractRule(reason, null);
      if (ruleText) {
        await saveLearnedRule(ruleText, "all", null, null, reason, lesson.id);
      }
    }
  } catch {
    // Don't fail the disapprove if lesson-saving fails.
  }

  return NextResponse.json({ draft, version });
}
