import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbInsert } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

const CreateJob = z.object({
  type: z.string().min(1),
  payload: z.any().optional().default({}),
});

// POST /api/agent/jobs — enqueue a job (used by organizer to queue draft jobs).
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = CreateJob.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const job = await dbInsert("agentJobs", {
    type: parsed.data.type,
    status: "queued",
    payload: parsed.data.payload,
  });
  return NextResponse.json({ job });
}
