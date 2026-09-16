import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbById, dbUpdate } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/outbox/:id/failed
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const { id } = await ctx.params;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z
    .object({ lease_token: z.string().min(1), error: z.string().optional() })
    .safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const row = await dbById("outbox", id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.lease_token !== parsed.data.lease_token) {
    return NextResponse.json({ error: "lease_mismatch" }, { status: 409 });
  }
  const updated = await dbUpdate("outbox", id, {
    status: "failed",
    lease_token: null,
    lease_expires_at: null,
    error: parsed.data.error || "unknown",
    finishedAt: Date.now(),
  });
  return NextResponse.json({ outbox: updated });
}
