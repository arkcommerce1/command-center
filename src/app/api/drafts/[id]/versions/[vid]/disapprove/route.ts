import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getDraft, getDraftVersion, saveDraft, saveDraftVersion } from "@/lib/cc/store";

// POST /api/drafts/[id]/versions/[vid]/disapprove  body: { reason: string }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  const { id, vid } = await params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: "draft not found" }, { status: 404 });
  const version = await getDraftVersion(vid);
  if (!version || version.draftId !== id) return NextResponse.json({ error: "version not found" }, { status: 404 });

  const b = await req.json().catch(() => ({}) as any);
  const reason = String(b?.reason || "").slice(0, 1000);
  if (!reason.trim()) return NextResponse.json({ error: "reason required" }, { status: 400 });

  version.status = "disapproved";
  version.disapproveReason = reason;
  await saveDraftVersion(version);

  draft.status = "disapproved";
  await saveDraft(draft);

  return NextResponse.json({ draft, version });
}
