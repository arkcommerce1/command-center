import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbById, dbUpdate } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/samples/:id/qc — Yuki QC result.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const { id } = await ctx.params;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z
    .object({
      qc_result: z.enum(["pass", "problem"]),
      qc_notes: z.string().optional().default(""),
      photos: z.array(z.string()).optional().default([]),
    })
    .safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const sample = await dbById("samples", id);
  if (!sample) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const updated = await dbUpdate("samples", id, parsed.data);
  return NextResponse.json({ sample: updated });
}
