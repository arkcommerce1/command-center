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
      company: z.string().optional(),
      channels: z.array(z.object({ kind: z.string(), value: z.string() })).optional(),
      factory_id: z.string().optional(),
    })
    .safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const existing = await dbById("contacts", id);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Haim's edits win (SPEC Goal 3): rows stamped created_by haim by the
  // dashboard PATCH are not overwritten by agents, except a self-stated role
  // with proof, which is the person speaking about themselves.
  const data = { ...parsed.data };
  if (existing.created_by === "haim") {
    const selfStated = data.role_source === "self_stated" && !!data.role_proof_message_id;
    for (const k of ["name", "description", "company", "channels", "factory_id"] as const) delete (data as any)[k];
    if (!selfStated) for (const k of ["role", "role_note", "role_source", "role_proof_message_id"] as const) delete (data as any)[k];
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "haim_locked" }, { status: 409 });
  }
  const updated = await dbUpdate("contacts", id, data);
  return NextResponse.json({ contact: updated });
}
