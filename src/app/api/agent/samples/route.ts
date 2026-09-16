import { NextRequest, NextResponse } from "next/server";
import { dbFind, dbById } from "@/lib/cc/agent-store";
import type { Sample, Shipment, ShipmentItem } from "@/lib/cc/types";

export const dynamic = "force-dynamic";

// GET /api/agent/samples — list all samples enriched with factory+product+stage+qc+photos.
// No agentAuth (browsers carry no bearer token; proxy.ts login-gates this path).
export async function GET() {
  const samples = (await dbFind("samples", () => true)) as Sample[];
  const shipments = (await dbFind("shipments", () => true)) as Shipment[];
  const shipmentItems = (await dbFind("shipmentItems", () => true)) as ShipmentItem[];

  // Build shipment lookup by sample_id
  const sampleShipments = new Map<string, Shipment[]>();
  for (const si of shipmentItems) {
    const arr = sampleShipments.get(si.sampleId) ?? [];
    arr.push(shipments.find((s) => s.id === si.shipmentId) as Shipment);
    sampleShipments.set(si.sampleId, arr.filter(Boolean));
  }

  // Enrich each sample with its shipments (both legs)
  const enriched = samples.map((s) => ({
    ...s,
    shipments: sampleShipments.get(s.id) ?? [],
  }));

  return NextResponse.json({ samples: enriched });
}

// POST /api/agent/samples — sample flow (§3.5). Kept from existing.
export async function POST(req: NextRequest) {
  const { z } = await import("zod");
  const { agentAuth, agentBody } = await import("@/lib/cc/agent-auth");
  const { dbInsert } = await import("@/lib/cc/agent-store");
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z
    .object({ factory_product_id: z.string().min(1), stage: z.string().optional().default("waiting_tracking") })
    .safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const sample = await dbInsert("samples", parsed.data);
  return NextResponse.json({ sample });
}
