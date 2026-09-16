import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbById, dbUpdate } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/messages/:id/annotate — product link, translation, language.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const { id } = await ctx.params;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z
    .object({
      factory_product_id: z.string().optional(),
      translation: z.string().optional(),
      lang: z.string().optional(),
    })
    .safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const msg = await dbById("messages", id);
  if (!msg) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const updated = await dbUpdate("messages", id, parsed.data);
  return NextResponse.json({ message: updated });
}
