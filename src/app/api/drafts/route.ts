import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listDrafts, pgInit, saveDraft } from "@/lib/cc/store";
import { Draft, DraftType, DraftLayer, uid } from "@/lib/cc/types";
import { dbFind as agentFind } from "@/lib/cc/agent-store";

const TYPES: DraftType[] = ["opening", "reply", "nudge", "thanks", "relay"];
const LAYERS: DraftLayer[] = [1, 2, 3, 4, 5];

// GET /api/drafts?status=pending — merge dashboard store + agent store drafts.
export async function GET(req: NextRequest) {
  await pgInit();
  const status = req.nextUrl.searchParams.get("status") || "";
  const factoryProductId = req.nextUrl.searchParams.get("factoryProductId") || undefined;

  // Dashboard store drafts
  const dashboardDrafts = await listDrafts(factoryProductId);

  // Agent store drafts (created by the plugin)
  let agentDrafts: any[] = [];
  try {
    agentDrafts = await agentFind("drafts", () => true);
  } catch { /* agent store may not be initialized */ }

  // Merge: agent drafts + dashboard drafts, deduped by id
  const seen = new Set<string>();
  const merged = [...agentDrafts, ...dashboardDrafts].filter((d: any) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });

  // Filter by status if requested
  const filtered = status ? merged.filter((d: any) => d.status === status) : merged;

  // Sort: pending first, then newest
  filtered.sort((a: any, b: any) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
  });

  return NextResponse.json(filtered);
}

// POST /api/drafts — create a new draft (writes to both stores for compat).
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
