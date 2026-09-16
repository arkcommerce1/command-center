import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";

export const dynamic = "force-dynamic";

// Approval-reply STUB (full logic is Goal 7). Parses Haim's WhatsApp codes:
// Y<draft>.<version> approve, N<draft>.<version> disapprove, S<draft> <text> suggest.
export function parseApprovalReply(text: string):
  | { action: "approve"; draft: string; version: string | null }
  | { action: "disapprove"; draft: string; version: string | null }
  | { action: "suggest"; draft: string; text: string }
  | { action: "unknown" } {
  const t = (text || "").trim();
  let m = t.match(/^([YN])\s*(\d+)(?:\.(\d+))?\s*$/i);
  if (m) return { action: m[1].toUpperCase() === "Y" ? "approve" : "disapprove", draft: m[2], version: m[3] || null };
  m = t.match(/^S\s*(\d+)\s+([\s\S]+)$/i);
  if (m) return { action: "suggest", draft: m[1], text: m[2].trim() };
  return { action: "unknown" };
}

// POST /api/agent/approval-reply
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z.object({ text: z.string().min(1), from: z.string().optional().default("") }).safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const result = parseApprovalReply(parsed.data.text);
  // Stub: acknowledge parse only; Goal 7 wires it to drafts/outbox.
  return NextResponse.json({ parsed: result, stub: true, message: "Full approval logic lands in Goal 7." });
}
