import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getDraft, getDraftVersion, saveDraft, saveDraftVersion } from "@/lib/cc/store";

// POST /api/drafts/[id]/versions/[vid]/disapprove  body: { reason?: string }
// The reason is optional and one line; it's saved as a style example source.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  const { id, vid } = await params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: "draft not found" }, { status: 404 });
  const version = await getDraftVersion(vid);
  if (!version || version.draftId !== id) return NextResponse.json({ error: "version not found" }, { status: 404 });
  if (draft.status !== "pending") {
    return NextResponse.json({ error: `Draft is ${draft.status}, not pending` }, { status: 422 });
  }

  const b = await req.json().catch(() => ({}) as any);
  const reason = String(b?.reason || "").replace(/\s+/g, " ").trim().slice(0, 140) || null;

  version.status = "disapproved";
  version.disapproveReason = reason;
  await saveDraftVersion(version);

  draft.status = "disapproved";
  await saveDraft(draft);

  return NextResponse.json({ draft, version });
}
