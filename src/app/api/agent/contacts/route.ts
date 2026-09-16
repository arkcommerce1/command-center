import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbById, dbFind, dbInsert, dbUpdate } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

const ContactCreate = z.object({
  name: z.string().min(1),
  type: z.enum(["ours", "factory"]).default("factory"),
  factory_id: z.string().optional().default(""),
  factory_product_id: z.string().optional().default(""),
  role: z.string().optional().default("sales_agent"),
  role_note: z.string().optional().default(""),
  role_source: z.enum(["default", "self_stated"]).default("default"),
  description: z.string().optional().default(""),
  company: z.string().optional().default(""),
  channels: z.array(z.object({ kind: z.string(), value: z.string() })).optional().default([]),
});

// POST /api/agent/contacts — contacts agent writes.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = ContactCreate.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const contact = await dbInsert("contacts", { ...parsed.data, created_by: "agent" });
  return NextResponse.json({ contact });
}
