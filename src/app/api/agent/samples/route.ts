import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbInsert } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/samples — sample flow (§3.5).
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z
    .object({ factory_product_id: z.string().min(1), stage: z.string().optional().default("waiting_for_tracking") })
    .safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const sample = await dbInsert("samples", parsed.data);
  return NextResponse.json({ sample });
}
