import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listFactoryProductLinks, pgInit, saveFactoryProductLink } from "@/lib/cc/store";
import { DraftLayer, FactoryProductLink, TrackingStage, uid, WaitingOn } from "@/lib/cc/types";

const LAYERS: DraftLayer[] = [1, 2, 3, 4, 5];
const STAGES: TrackingStage[] = ["none", "in_yiwu_qc", "in_box", "to_new_york", "decision"];
const WAITING: WaitingOn[] = ["haim", "factory", "yuki", "china_office", "carrier", "donna"];

// GET /api/factory-product-links — list all factory+product links.
export async function GET() {
  await pgInit();
  return NextResponse.json(await listFactoryProductLinks());
}

// POST /api/factory-product-links — create a new factory+product link.
export async function POST(req: NextRequest) {
  await pgInit();
  const b = await req.json();
  if (!String(b.companyId || "").trim() || !String(b.productId || "").trim()) {
    return NextResponse.json({ error: "companyId and productId required" }, { status: 400 });
  }
  const link: FactoryProductLink = {
    id: uid(),
    companyId: String(b.companyId),
    productId: String(b.productId),
    currentLayer: LAYERS.includes(b.currentLayer) ? b.currentLayer : 1,
    trackingStage: STAGES.includes(b.trackingStage) ? b.trackingStage : "none",
    statusLine: String(b.statusLine || "").slice(0, 500),
    nextStep: String(b.nextStep || "").slice(0, 500),
    waitingOn: WAITING.includes(b.waitingOn) ? b.waitingOn : null,
    since: Date.now(),
    promisedShipDate: b.promisedShipDate != null ? String(b.promisedShipDate) : null,
    dropped: null,
  };
  await saveFactoryProductLink(link);
  return NextResponse.json(link);
}
