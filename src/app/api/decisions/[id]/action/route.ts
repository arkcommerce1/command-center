import { type NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import {
  approveUDraft,
  approveUQuestion,
  disapproveUDraft,
  disapproveUQuestion,
  ignoreUDraft,
  ignoreUQuestion,
  suggestChangesOnDraft,
  suggestChangesOnQuestion,
} from "@/lib/cc/actionables-store";

// POST /api/decisions/[id]/action — the 4 Actionables buttons.
// [id] is "draft:<id>" or "question:<id>" (as returned by GET /api/decisions).
// Body: { action: "approve" | "suggest" | "disapprove" | "ignore", text?, sendAfter? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sep = id.indexOf(":");
  const kind = sep === -1 ? "" : id.slice(0, sep);
  const realId = sep === -1 ? "" : id.slice(sep + 1);
  if (!realId || (kind !== "draft" && kind !== "question")) {
    return NextResponse.json({ error: "invalid card id" }, { status: 400 });
  }
  const b = await req.json().catch(() => ({}) as any);
  const action = typeof b?.action === "string" ? b.action : "";
  const text = typeof b?.text === "string" ? b.text : "";

  let result: { ok: true; message?: string } | { ok: false; httpStatus: number; message: string };

  if (kind === "draft") {
    if (action === "approve") {
      result = await approveUDraft(realId, {
        channel: "dashboard",
        approver: b?.approver ? String(b.approver).slice(0, 120) : "haim",
        sendAfter: b?.sendAfter ?? null,
      });
    } else if (action === "suggest") {
      if (!text.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
      result = await suggestChangesOnDraft(realId, text.trim());
    } else if (action === "disapprove") {
      result = await disapproveUDraft(realId, text.trim() || null);
    } else if (action === "ignore") {
      result = await ignoreUDraft(realId);
    } else {
      return NextResponse.json({ error: "invalid action" }, { status: 400 });
    }
  } else {
    if (action === "approve") {
      result = await approveUQuestion(realId);
    } else if (action === "suggest") {
      if (!text.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
      result = await suggestChangesOnQuestion(realId, text.trim());
    } else if (action === "disapprove") {
      result = await disapproveUQuestion(realId);
    } else if (action === "ignore") {
      result = await ignoreUQuestion(realId);
    } else {
      return NextResponse.json({ error: "invalid action" }, { status: 400 });
    }
  }

  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.httpStatus });
  return NextResponse.json({ ok: true, message: result.message ?? null });
}
