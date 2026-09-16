import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getDraft, getDraftVersion, listDraftVersions, saveDraft, saveDraftVersion } from "@/lib/cc/store";
import { ApprovalChannel } from "@/lib/cc/types";

const CHANNELS: ApprovalChannel[] = ["dashboard", "whatsapp"];

// POST /api/drafts/[id]/versions/[vid]/approve
// Marks the version approved, marks the draft sent, and marks every other
// version of the draft as 'replaced' unless it's already approved/disapproved.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  const { id, vid } = await params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: "draft not found" }, { status: 404 });
  const version = await getDraftVersion(vid);
  if (!version || version.draftId !== id) return NextResponse.json({ error: "version not found" }, { status: 404 });

  const allVersions = await listDraftVersions(id);
  const latest = allVersions.reduce((m, v) => (v.versionNumber > m.versionNumber ? v : m), version);
  if (latest.versionNumber !== version.versionNumber) {
    return NextResponse.json(
      { error: `${id} was updated. Latest is version ${latest.versionNumber}.`, latestVersionId: latest.id, latestVersionNumber: latest.versionNumber },
      { status: 409 }
    );
  }

  const b = await req.json().catch(() => ({}) as any);
  const channel: ApprovalChannel = CHANNELS.includes(b?.approvalChannel) ? b.approvalChannel : "dashboard";
  const approver = b?.approver ? String(b.approver).slice(0, 120) : "haim";
  const now = Date.now();

  version.status = "approved";
  version.approvalChannel = channel;
  version.approver = approver;
  version.approvedAt = now;
  version.sentAt = now;
  await saveDraftVersion(version);

  const all = await listDraftVersions(id);
  for (const other of all) {
    if (other.id === version.id) continue;
    if (other.status === "pending") {
      other.status = "replaced";
      await saveDraftVersion(other);
    }
  }

  draft.status = "sent";
  await saveDraft(draft);

  return NextResponse.json({ draft, version });
}
