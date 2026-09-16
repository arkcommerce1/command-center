import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbById, dbInsert } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/shipments/:id/items — attach a sample to a shipment.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const { id } = await ctx.params;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z.object({ sample_id: z.string().min(1) }).safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const shipment = await dbById("shipments", id);
  if (!shipment) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const item = await dbInsert("shipmentItems", { shipment_id: id, sample_id: parsed.data.sample_id });
  return NextResponse.json({ item });
}
