import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { dbFind } from "@/lib/cc/agent-store";

// GET /api/messages?chat_id=&limit= — read-only slice for the dashboard.
// Newest first, each row carries chat_id, chat_name, sender, translation.
// Login-gated by the proxy (not an agent route).
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const chatId = q.get("chat_id") || q.get("chatId") || "";
  const limit = Math.min(Math.max(Number(q.get("limit")) || 200, 1), 200);
  const messages = await dbFind("messages", () => true);
  const chats = await dbFind("chats", () => true);
  const contacts = await dbFind("contacts", () => true);
  const chatById = new Map(chats.map((c: any) => [c.id, c]));
  const contactById = new Map(contacts.map((c: any) => [c.id, c]));
  const rows = messages
    .filter((m: any) => !chatId || m.chat_id === chatId)
    .sort((a: any, b: any) => (Number(b.sent_at) || 0) - (Number(a.sent_at) || 0))
    .slice(0, limit)
    .map((m: any) => ({
      id: m.id,
      chat_id: m.chat_id,
      chat_name: chatById.get(m.chat_id)?.name || chatById.get(m.chat_id)?.external_id || "",
      sender: contactById.get(m.contact_id)?.name || m.contact_id || "",
      direction: m.direction || "in",
      text: m.text || "",
      translation: m.translation || "",
      sent_at: m.sent_at || null,
    }));
  return NextResponse.json(rows);
}
