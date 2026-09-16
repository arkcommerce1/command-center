import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbInsert } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/adjustments — record a proposed spec change.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z
    .object({
      factory_product_id: z.string().min(1),
      field_key: z.string().min(1),
      proposed_value: z.string().min(1),
      message_id: z.string().optional().default(""),
      result: z.enum(["accepted", "declined", "pending"]).default("pending"),
    })
    .safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const adjustment = await dbInsert("adjustments", parsed.data);
  return NextResponse.json({ adjustment });
}
