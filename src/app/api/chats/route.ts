import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { dbFind } from "@/lib/cc/agent-store";

// GET /api/chats — read-only list of ingested chats, newest activity first.
// Login-gated by the proxy (not an agent route).
export async function GET() {
  const chats = await dbFind("chats", () => true);
  const messages = await dbFind("messages", () => true);
  const lastByChat = new Map<string, number>();
  for (const m of messages) {
    const t = Number(m.sent_at) || 0;
    if (t > (lastByChat.get(m.chat_id) || 0)) lastByChat.set(m.chat_id, t);
  }
  const out = chats
    .map((c: any) => ({
      id: c.id,
      name: c.name || c.external_id || "Unnamed chat",
      channel: c.channel || "whatsapp",
      kind: c.kind || "group",
      last_at: lastByChat.get(c.id) || 0,
      message_count: messages.filter((m: any) => m.chat_id === c.id).length,
    }))
    .sort((a: any, b: any) => b.last_at - a.last_at);
  return NextResponse.json(out);
}
