import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbById, dbInsert } from "@/lib/cc/agent-store";
import { validateStepProof } from "@/lib/cc/step-proof";

export const dynamic = "force-dynamic";

const Steps = z.object({
  factory_product_id: z.string().min(1),
  step: z.number().int().min(1).max(5),
  proof_message_id: z.string().min(1),
});

// POST /api/agent/steps — mark a step done with its proof message.
// REJECTS proofs that are not inbound-from-factory-contact or that only acknowledge.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = Steps.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const proof = await dbById("messages", parsed.data.proof_message_id);
  if (!proof) return NextResponse.json({ error: "proof_not_found" }, { status: 404 });
  const sender = proof.contact_id ? await dbById("contacts", proof.contact_id) : null;
  const check = validateStepProof({
    direction: proof.direction,
    senderType: sender?.type || "factory",
    text: proof.text || "",
  });
  if (!check.ok) return NextResponse.json({ error: "proof_rejected", reason: check.reason }, { status: 422 });
  const step = await dbInsert("steps", {
    factory_product_id: parsed.data.factory_product_id,
    step: parsed.data.step,
    proof_message_id: parsed.data.proof_message_id,
    done_at: Date.now(),
  });
  return NextResponse.json({ step });
}
