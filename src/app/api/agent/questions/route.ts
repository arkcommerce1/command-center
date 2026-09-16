import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbInsert } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

const kinds = ["question", "fee", "product_pick", "sample_flag", "sample_review", "send_uncertain", "guardrail_block"] as const;

// POST /api/agent/questions — organizer writes.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z
    .object({
      factory_product_id: z.string().min(1),
      kind: z.enum(kinds).default("question"),
      body: z.any(),
      importance: z.enum(["high", "medium", "low"]).default("medium"),
    })
    .safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const question = await dbInsert("questions", { ...parsed.data, status: "open" });
  return NextResponse.json({ question });
}
