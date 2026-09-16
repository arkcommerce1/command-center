import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbById, dbUpdate } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

async function finish(req: NextRequest, id: string, status: "sent" | "failed" | "uncertain") {
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z
    .object({
      lease_token: z.string().min(1),
      external_message_ids: z.array(z.string()).optional().default([]),
      error: z.string().optional(),
    })
    .safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const row = await dbById("outbox", id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.lease_token !== parsed.data.lease_token) {
    return NextResponse.json({ error: "lease_mismatch" }, { status: 409 });
  }
  // Uncertain rows are never resent automatically (SPEC §1.3).
  const updated = await dbUpdate("outbox", id, {
    status,
    lease_token: null,
    lease_expires_at: null,
    external_message_ids: parsed.data.external_message_ids,
    error: parsed.data.error || null,
    finishedAt: Date.now(),
  });
  return NextResponse.json({ outbox: updated });
}

// POST /api/agent/outbox/:id/sent
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const { id } = await ctx.params;
  return finish(req, id, "sent");
}
