import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getDraft, saveDraft } from "@/lib/cc/store";
import { DraftStatus } from "@/lib/cc/types";

const STATUSES: DraftStatus[] = ["pending", "sent", "disapproved", "closed"];

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getDraft(id);
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(d);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getDraft(id);
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
  const b = await req.json();
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
    d.status = b.status;
  }
  if (b.trigger !== undefined) d.trigger = String(b.trigger).slice(0, 500);
  await saveDraft(d);
  return NextResponse.json(d);
}
