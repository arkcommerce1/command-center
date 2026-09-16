import { NextRequest, NextResponse } from "next/server";
import { agentAuth } from "@/lib/cc/agent-auth";
import { claimOne, dbById } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/outbox/claim — lease so a row reaches sent only once.
// Enriched with the chat's external id + channel so the plugin poller can
// route the bubbles through the WhatsApp/email bridge.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const row = await claimOne("outbox", (x) => x.status === "queued");
  if (!row) return NextResponse.json({ outbox: null });
  const chat = row.chat_id ? await dbById("chats", row.chat_id).catch(() => null) : null;
  return NextResponse.json({
    outbox: {
      ...row,
      chat_external_id: chat?.external_id ?? null,
      chat_channel: chat?.channel ?? null,
      chat_name: chat?.name ?? null,
    },
  });
}
