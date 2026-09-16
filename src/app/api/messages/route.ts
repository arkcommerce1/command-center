import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { dbFind } from "@/lib/cc/agent-store";

// GET /api/messages?chatId=... — read-only messages for one chat, oldest first.
// Login-gated by the proxy (not an agent route).
export async function GET(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get("chatId") || "";
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });
  const messages = await dbFind("messages", (m: any) => m.chat_id === chatId);
  messages.sort((a: any, b: any) => (Number(a.sent_at) || 0) - (Number(b.sent_at) || 0));
  return NextResponse.json(
    messages.slice(-200).map((m: any) => ({
      id: m.id,
      direction: m.direction || "in",
      text: m.text || "",
      translation: m.translation || "",
      sent_at: m.sent_at || null,
    })),
  );
}
