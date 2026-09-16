import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getFactoryProductLink, saveFactoryProductLink } from "@/lib/cc/store";
import { DraftLayer, TrackingStage, WaitingOn } from "@/lib/cc/types";

const LAYERS: DraftLayer[] = [1, 2, 3, 4, 5];
const STAGES: TrackingStage[] = ["none", "in_yiwu_qc", "in_box", "to_new_york", "decision"];
const WAITING: WaitingOn[] = ["haim", "factory", "yuki", "china_office", "carrier", "donna"];

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const link = await getFactoryProductLink(id);
  if (!link) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(link);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const link = await getFactoryProductLink(id);
  if (!link) return NextResponse.json({ error: "not found" }, { status: 404 });
  const b = await req.json();
  if (b.currentLayer !== undefined && LAYERS.includes(b.currentLayer)) link.currentLayer = b.currentLayer;
  if (b.trackingStage !== undefined && STAGES.includes(b.trackingStage)) link.trackingStage = b.trackingStage;
  if (b.statusLine !== undefined) link.statusLine = String(b.statusLine).slice(0, 500);
  if (b.nextStep !== undefined) link.nextStep = String(b.nextStep).slice(0, 500);
  if (b.waitingOn !== undefined) link.waitingOn = b.waitingOn === null ? null : WAITING.includes(b.waitingOn) ? b.waitingOn : link.waitingOn;
  if (b.promisedShipDate !== undefined) link.promisedShipDate = b.promisedShipDate === null ? null : String(b.promisedShipDate);
  if (b.dropped !== undefined) {
    link.dropped = b.dropped === null
      ? null
      : {
          layer: Number(b.dropped.layer) || 0,
          reason: String(b.dropped.reason || "").slice(0, 500),
          suggestedBy: String(b.dropped.suggestedBy || "").slice(0, 120),
          confirmedBy: b.dropped.confirmedBy != null ? String(b.dropped.confirmedBy).slice(0, 120) : null,
          confirmedAt: typeof b.dropped.confirmedAt === "number" ? b.dropped.confirmedAt : null,
        };
  }
  await saveFactoryProductLink(link);
  return NextResponse.json(link);
}
