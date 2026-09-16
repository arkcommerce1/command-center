import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbInsert } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/notifications — queue a message to an Ours contact (auto-sendable).
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z
    .object({
      contact_id: z.string().optional().default(""),
      chat_id: z.string().optional().default(""),
      text: z.string().min(1),
      attachments: z.array(z.string()).optional().default([]),
    })
    .safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const notification = await dbInsert("notifications", { ...parsed.data, status: "queued", sent_at: null });
  return NextResponse.json({ notification });
}
