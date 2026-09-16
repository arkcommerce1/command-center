import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listDrafts, pgInit, saveDraft } from "@/lib/cc/store";
import { Draft, DraftLayer, DraftType, uid } from "@/lib/cc/types";

const TYPES: DraftType[] = ["opening", "reply", "nudge", "thanks", "relay"];
const LAYERS: DraftLayer[] = [1, 2, 3, 4, 5];

// GET /api/drafts?factoryProductId=... — list drafts, optionally scoped to a factory+product link.
export async function GET(req: NextRequest) {
  await pgInit();
  const factoryProductId = req.nextUrl.searchParams.get("factoryProductId") || undefined;
  return NextResponse.json(await listDrafts(factoryProductId));
}

// POST /api/drafts — create a new draft.
export async function POST(req: NextRequest) {
  await pgInit();
  const b = await req.json();
  if (!String(b.factoryProductId || "").trim()) {
    return NextResponse.json({ error: "factoryProductId required" }, { status: 400 });
  }
  const type: DraftType = TYPES.includes(b.type) ? b.type : "opening";
  const layer: DraftLayer = LAYERS.includes(b.layer) ? b.layer : 1;
  const d: Draft = {
    id: uid(),
    factoryProductId: String(b.factoryProductId),
    type,
    layer,
    status: "pending",
    trigger: String(b.trigger || "").slice(0, 500),
    createdAt: Date.now(),
  };
  await saveDraft(d);
  return NextResponse.json(d);
}
