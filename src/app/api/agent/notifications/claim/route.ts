import { NextRequest, NextResponse } from "next/server";
import { agentAuth } from "@/lib/cc/agent-auth";
import { claimOne } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/notifications/claim — lease so one winner sends.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const n = await claimOne("notifications", (x) => x.status === "queued");
  if (!n) return NextResponse.json({ notification: null });
  return NextResponse.json({ notification: n });
}
