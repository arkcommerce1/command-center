import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { agentAuth } from "@/lib/cc/agent-auth";
import { dbFind } from "@/lib/cc/agent-store";

// GET /api/agent/messages?chat_id=... — all messages, optionally filtered by chat_id.
export async function GET(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const chatId = req.nextUrl.searchParams.get("chat_id") || req.nextUrl.searchParams.get("chatId") || "";
  const messages = await dbFind("messages", (m: any) => !chatId || m.chat_id === chatId);
  messages.sort((a: any, b: any) => (Number(a.sent_at) || 0) - (Number(b.sent_at) || 0));
  return NextResponse.json(messages.slice(-200));
}
