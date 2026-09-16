import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbInsert, dbFind, dbUpdate } from "@/lib/cc/agent-store";
import { uid } from "@/lib/cc/types";

export const dynamic = "force-dynamic";

const CreateFactory = z.object({
  name: z.string().min(1),
  company_name: z.string().optional().default(""),
  chat_id: z.string().optional().default(""),
  product_id: z.string().optional().default(""),
  can_share_volumes: z.boolean().optional().default(false),
});

// POST /api/agent/factories — create a factory + factory_product link.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = CreateFactory.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;

  const factoryId = uid();
  const factory = {
    id: factoryId,
    name: b.name,
    company_name: b.company_name || b.name,
    can_share_volumes: b.can_share_volumes,
    archived_at: null,
  };
  await dbInsert("factories", factory);

  // Link to product if provided.
  if (b.product_id) {
    const fpId = uid();
    await dbInsert("factoryProducts", {
      id: fpId,
      factory_id: factoryId,
      product_id: b.product_id,
      step1: { proof_message_id: null, done_at: null },
      step2: { proof_message_id: null, done_at: null },
      step3: { proof_message_id: null, done_at: null },
      step4: { proof_message_id: null, done_at: null },
      step5: { proof_message_id: null, done_at: null },
      status_sentence: "",
      waiting_on: "factory",
      waiting_since: Date.now(),
      next_step: "Contact factory",
      product_guessed: false,
      followups_unanswered: 0,
      archived_at: null,
    });
  }

  // Link chat to factory if provided.
  if (b.chat_id) {
    const chats = await dbFind("chats", (c: any) => c.id === b.chat_id);
    if (chats[0]) {
      await dbUpdate("chats", b.chat_id, { factory_id: factoryId });
    }
  }

  return NextResponse.json({ factory });
}
