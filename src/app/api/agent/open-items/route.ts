import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbInsert } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/open-items — organizer opens an item.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z
    .object({
      factory_product_id: z.string().min(1),
      direction: z.enum(["we_owe", "they_owe"]),
      kind: z.enum(["question", "sample_tracking"]).default("question"),
      summary: z.string().min(1),
      opened_message_id: z.string().optional().default(""),
    })
    .safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const item = await dbInsert("openItems", { ...parsed.data, opened_at: Date.now(), followups_sent: 0 });
  return NextResponse.json({ open_item: item });
}
