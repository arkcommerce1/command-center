import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { approveDraftVersion } from "@/lib/cc/approve-flow";
import { ApprovalChannel } from "@/lib/cc/types";

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
  return NextResponse.json({ draft: result.draft, version: result.version, outbox: result.outbox, code: result.code, alreadyApproved: result.alreadyApproved });
}
