import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { claimOne } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/jobs/claim — 5-min lease: sets lease_token + lease_expires_at.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req).catch(() => [null, null] as any);
  void err;
  const parsed = z.object({ type: z.string().optional() }).safeParse(raw || {});
  const type = parsed.success ? parsed.data.type : undefined;
  const job = await claimOne(
    "agentJobs",
    (j) => j.status === "queued" && (!type || j.type === type),
  );
  if (!job) return NextResponse.json({ job: null });
  return NextResponse.json({ job });
}
