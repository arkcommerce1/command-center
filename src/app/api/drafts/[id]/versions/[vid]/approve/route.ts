import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { approveDraftVersion } from "@/lib/cc/approve-flow";
import { ApprovalChannel } from "@/lib/cc/types";
import { saveLesson, saveDraftExample } from "@/lib/cc/learning";
import { dbFind } from "@/lib/cc/agent-store";

const CHANNELS: ApprovalChannel[] = ["dashboard", "whatsapp"];

// POST /api/drafts/[id]/versions/[vid]/approve
// Latest-only + pending + hash guards, then exactly one agent-store outbox row
// (unique draft_version_id) that the plugin poller sends. Double-approve
// returns already-approved without resending.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  const { id, vid } = await params;
  const b = await req.json().catch(() => ({}) as any);
  const result = await approveDraftVersion({
    draftId: id,
    versionId: vid,
    channel: CHANNELS.includes(b?.approvalChannel) ? b.approvalChannel : "dashboard",
    approver: b?.approver ? String(b.approver).slice(0, 120) : "haim",
    sendAfter: (b?.sendAfter ?? null) as any,
    expectedHash: typeof b?.expectedHash === "string" ? b.expectedHash : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.httpStatus });

  // Goal 3: Save a lesson record for the approval.
  if (result.version && result.draft) {
    try {
      // Get the first version (the AI's original draft) for comparison.
      const allVersions = await dbFind("draftVersions", (v: any) => v.draftId === id);
      const firstVersion = allVersions.sort((a: any, b: any) => a.versionNumber - b.versionNumber)[0];
      const aiDraft = firstVersion?.text || null;
      const approvedText = result.version.text || "";

      // Get the incoming message that triggered this draft.
      const draftRow = await dbFind("drafts", (d: any) => d.id === id);
      const fp = draftRow[0]?.factory_product_id || draftRow[0]?.factoryProductId || null;
      const messages = fp ? await dbFind("messages", (m: any) => m.factory_product_id === fp && m.direction === "in") : [];
      const lastInbound = messages.sort((a: any, b: any) => (Number(b.sent_at) || 0) - (Number(a.sent_at) || 0))[0];

      await saveLesson({
        action: "approved",
        draftId: id,
        versionId: vid,
        factoryProductId: fp,
        factoryName: null,
        productName: null,
        incomingMessage: lastInbound?.text || null,
        aiDraft,
        feedbackText: null, // approved as-is, no feedback
        finalSentText: approvedText,
        step: null,
      });

      // Save a draft example for future drafts to learn from.
      await saveDraftExample(
        id,
        fp,
        null,
        lastInbound?.text || "",
        approvedText,
        "approved",
        null,
      );
    } catch {
      // Don't fail the approval if lesson-saving fails.
    }
  }

  return NextResponse.json({ draft: result.draft, version: result.version, outbox: result.outbox, code: result.code, alreadyApproved: result.alreadyApproved });
}
