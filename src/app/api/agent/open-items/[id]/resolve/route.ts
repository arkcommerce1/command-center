import { NextRequest, NextResponse } from "next/server";
import { agentAuth } from "@/lib/cc/agent-auth";
import { dbById, dbUpdate } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/open-items/:id/resolve
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const { id } = await ctx.params;
  const item = await dbById("openItems", id);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const updated = await dbUpdate("openItems", id, { resolved_at: Date.now() });
  return NextResponse.json({ open_item: updated });
}
