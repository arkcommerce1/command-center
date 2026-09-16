import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { pgInit, undoActivityEntry } from "@/lib/cc/store";

// POST /api/activity/undo — reverse one undoable activity entry (P10).
// Body: { id: activity entry id }. Restores the entry's before-state
// (or removes the entity when before is null) and marks undone_at.
export async function POST(req: NextRequest) {
  await pgInit();
  const b = await req.json().catch(() => null);
  if (!b || !String(b.id || "").trim()) return NextResponse.json({ error: "id required" }, { status: 400 });
  const result = await undoActivityEntry(String(b.id));
  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ entry: result.entry });
}
