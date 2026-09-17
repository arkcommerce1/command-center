import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbFind, dbInsert, dbUpdate } from "@/lib/cc/agent-store";
import { checkGuardrail } from "@/lib/cc/guardrail";

export const dynamic = "force-dynamic";

const Drafts = z.object({
  factory_product_id: z.string().min(1),
  chat_id: z.string().min(1),
  kind: z.enum(["reply", "opener", "followup", "fee_pay", "sample_change", "decline"]).default("reply"),
  reason: z.string().optional().default(""),
  bubbles: z.array(z.string()).min(1).max(4),
  source: z.enum(["ai", "suggestion", "update"]).default("ai"),
  rules_used: z.any().optional(),
});

function hashBubbles(bubbles: string[]): string {
  return createHash("sha256").update(JSON.stringify(bubbles)).digest("hex");
}

// POST /api/agent/drafts — create a draft, or a new version of the pending one.
// Runs the guardrail first: a blocked draft becomes a guardrail_block question, not a draft.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = Drafts.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;

  const guardrail = checkGuardrail(b.bubbles.join("\n"));
  if (guardrail.blocked) {
    const question = await dbInsert("questions", {
      factory_product_id: b.factory_product_id,
      kind: "guardrail_block",
      body: { bubbles: b.bubbles, reason: guardrail.reason },
      status: "open",
    });
    return NextResponse.json({ blocked: true, reason: guardrail.reason, question }, { status: 422 });
  }

  let draft = (await dbFind("drafts", (d) => d.factory_product_id === b.factory_product_id && d.status === "pending"))[0];
  if (!draft) {
    draft = await dbInsert("drafts", {
      factory_product_id: b.factory_product_id,
      chat_id: b.chat_id,
      kind: b.kind,
      reason: b.reason,
      status: "pending",
    });
  }
  const versions = await dbFind("draftVersions", (v) => v.draft_id === draft.id);
  const version = await dbInsert("draftVersions", {
    draft_id: draft.id,
    version: versions.length + 1,
    bubbles: b.bubbles,
    content_hash: hashBubbles(b.bubbles),
    source: b.source,
    rules_used: b.rules_used || null,
    guardrail: { blocked: false, reason: null },
  });
  await dbUpdate("drafts", draft.id, { current_version: version.version });
  return NextResponse.json({ draft: await dbFind("drafts", (d) => d.id === draft.id).then((r) => r[0]), version });
}
