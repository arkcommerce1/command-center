import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbInsert } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/status — status sentence, waiting on, next step, note.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z
    .object({
      factory_product_id: z.string().min(1),
      status_sentence: z.string().optional().default(""),
      waiting_on: z.enum(["haim", "factory", "yuki", "carrier", "none"]).default("none"),
      next_step: z.string().optional().default(""),
      note: z.string().optional().default(""),
    })
    .safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const status = await dbInsert("statusUpdates", { ...parsed.data, waiting_since: Date.now() });
  return NextResponse.json({ status });
}
