import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbById, dbFind, dbPut, dbUpdate } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// POST /api/agent/contacts/merge — merge duplicate contacts (e.g. WhatsApp + email same person).
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = z.object({ keep_id: z.string().min(1), merge_id: z.string().min(1) }).safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const keep = await dbById("contacts", parsed.data.keep_id);
  const merge = await dbById("contacts", parsed.data.merge_id);
  if (!keep || !merge) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const merged = await dbUpdate("contacts", keep.id, {
    channels: [...(keep.channels || []), ...(merge.channels || [])],
    description: keep.description || merge.description,
  });
  // Re-point chat members, then drop the merged row.
  const members = await dbFind("chatMembers", (m) => m.contact_id === merge.id);
  const allMembers = await dbFind("chatMembers", () => true);
  for (const m of members) {
    const row = allMembers.find((x) => x.id === m.id);
    if (row) row.contact_id = keep.id;
  }
  await dbPut("chatMembers", allMembers);
  const rest = (await dbFind("contacts", (c) => c.id !== merge.id));
  await dbPut("contacts", rest);
  return NextResponse.json({ contact: merged, merged_id: merge.id });
}
