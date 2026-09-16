import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { dbGet } from "@/lib/cc/agent-store";

// GET /api/messages — dashboard-readable, read-only view of ingested
// WhatsApp/email messages (agent-side store). Same convention as the other
// dashboard APIs (/api/contacts, /api/actionables): no token, no writes.
// Query: chat_id (optional), limit (default 50, max 200). Newest-first:
// [{id, chat_id, chat_name, sender, direction, text, translation, sent_at}].
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const chatId = url.searchParams.get("chat_id") || "";
  const rawLimit = Number(url.searchParams.get("limit") || "50");
  const limit = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50));

  const [messages, chats, contacts] = await Promise.all([
    dbGet("messages"),
    dbGet("chats"),
    dbGet("contacts"),
  ]);
  const chatName = new Map((chats as any[]).map((c) => [c.id, c.name || ""]));
  const senderName = new Map((contacts as any[]).map((c) => [c.id, c.name || ""]));

  const rows = (messages as any[])
    .filter((m) => !chatId || m.chat_id === chatId)
    .sort((a, b) => Number(b.sent_at || 0) - Number(a.sent_at || 0))
    .slice(0, limit)
    .map((m) => ({
      id: m.id,
      chat_id: m.chat_id || "",
      chat_name: chatName.get(m.chat_id) || "",
      sender: (m.contact_id && senderName.get(m.contact_id)) || "",
      direction: m.direction || "in",
      text: m.text || "",
      translation: m.translation || "",
      sent_at: Number(m.sent_at || 0),
    }));
  return NextResponse.json(rows);
}
