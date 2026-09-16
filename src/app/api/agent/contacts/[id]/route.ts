import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbById, dbUpdate } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// PATCH /api/agent/contacts/:id — contacts agent updates.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const { id } = await ctx.params;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z
    .object({
      name: z.string().optional(),
      role: z.string().optional(),
      role_note: z.string().optional(),
      role_source: z.enum(["default", "self_stated"]).optional(),
      role_proof_message_id: z.string().optional(),
      description: z.string().optional(),
      factory_id: z.string().optional(),
    })
    .safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const existing = await dbById("contacts", id);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const updated = await dbUpdate("contacts", id, parsed.data);
  return NextResponse.json({ contact: updated });
}
