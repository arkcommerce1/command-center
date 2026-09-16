import { NextRequest, NextResponse } from "next/server";
import { agentAuth } from "@/lib/cc/agent-auth";
import { claimOne } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/outbox/claim — lease so a row reaches sent only once.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const row = await claimOne("outbox", (x) => x.status === "queued");
  if (!row) return NextResponse.json({ outbox: null });
  return NextResponse.json({ outbox: row });
}
