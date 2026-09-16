import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbFind, dbInsert } from "@/lib/cc/agent-store";
import type { Shipment } from "@/lib/cc/types";

export const dynamic = "force-dynamic";

// GET /api/agent/shipments — list all shipments with leg, tracking, carrier, status, eta, events.
export async function GET() {
  const shipments = (await dbFind("shipments", () => true)) as Shipment[];
  return NextResponse.json({ shipments });
}

// POST /api/agent/shipments — create a shipment.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z
    .object({
      leg: z.enum(["china_to_yiwu", "yiwu_to_ny"]),
      tracking_number: z.string().optional().default(""),
      carrier: z.string().optional().default(""),
      status: z.string().optional().default("created"),
    })
    .safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const shipment = await dbInsert("shipments", parsed.data);
  return NextResponse.json({ shipment });
}
