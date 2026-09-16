import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbById, dbUpdate } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

async function finish(req: NextRequest, id: string, status: "done" | "failed") {
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z.object({ lease_token: z.string().min(1), error: z.string().optional() }).safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const job = await dbById("agentJobs", id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (job.lease_token !== parsed.data.lease_token) {
    return NextResponse.json({ error: "lease_mismatch" }, { status: 409 });
  }
  const updated = await dbUpdate("agentJobs", id, {
    status,
    lease_token: null,
    lease_expires_at: null,
    error: status === "failed" ? parsed.data.error || "unknown" : null,
    finishedAt: Date.now(),
  });
  return NextResponse.json({ job: updated });
}

// POST /api/agent/jobs/:id/done — clears the lease, marks done.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const { id } = await ctx.params;
  return finish(req, id, "done");
}
