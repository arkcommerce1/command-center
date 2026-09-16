import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { dbFind, dbInsert, dbUpdate } from "@/lib/cc/agent-store";
import { resolveChatId } from "@/lib/cc/approve-flow";
import { resolveFeeMessage } from "@/lib/cc/decision-bridge";
import { getQuestion, saveAgentJob, saveQuestion } from "@/lib/cc/store";
import { uid } from "@/lib/cc/types";

// POST /api/questions/[id]/answer — Haim answers a question card (Goal 7).
// Body: { answer?: string, resolution?: string }. Side effects per kind:
// - question / guardrail_block / fee+suggest-changes: save answer, mark
//   answered, queue a draft job so the drafter writes the reply.
// - fee + Approve fee (resolution "approve-fee"): queue an agent-store outbox
//   row with EXACTLY the shown @Yuki message, mark answered.
// - fee + Don't pay (resolution "decline"): mark answered, no send.
// - product_pick: { answer: { productId } } records the chosen product.
// - send_uncertain: resolution "mark-sent" flips the outbox row to sent;
//   "send-again" re-queues it. Never auto-resends otherwise.
// - sample_flag / sample_review: display-only until Goal 10 (422).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = await getQuestion(id);
  if (!q) return NextResponse.json({ error: "question not found" }, { status: 404 });
  if (q.status !== "open") return NextResponse.json({ error: `question is ${q.status}` }, { status: 422 });
  const b = await req.json().catch(() => ({}) as any);
  const resolution = typeof b?.resolution === "string" ? b.resolution : null;
  const body = (q.body ?? {}) as any;

  if (q.kind === "sample_flag" || q.kind === "sample_review") {
    return NextResponse.json({ error: "sample cards are handled in Goal 10" }, { status: 422 });
  }

  if (q.kind === "fee" && resolution !== "approve-fee" && resolution !== "decline" && resolution !== "changes") {
    return NextResponse.json({ error: "resolution required: approve-fee | decline | changes" }, { status: 400 });
  }

  if (q.kind === "fee" && resolution === "approve-fee") {
    if (!q.factoryProductId) {
      return NextResponse.json({ error: "fee question has no factory_product; cannot queue send" }, { status: 409 });
    }
    const chatId = await resolveChatId(q.factoryProductId);
    if (!chatId) {
      return NextResponse.json({ error: "no chat found; cannot queue send", code: "no_chat" }, { status: 409 });
    }
    const message = resolveFeeMessage(body);
    const existing = await dbFind("outbox", (x: any) => x.draft_version_id === `fee:${q.id}`);
    let outbox = existing[0];
    if (!outbox) {
      outbox = await dbInsert("outbox", {
        draft_version_id: `fee:${q.id}`,
        chat_id: chatId,
        bubbles: [message],
        status: "queued",
        send_after: null,
      });
    }
    q.answer = { resolution: "approved", message };
    q.status = "answered";
    await saveQuestion(q);
    return NextResponse.json({ question: q, outbox, feeMessage: message });
  }

  if (q.kind === "fee" && resolution === "decline") {
    q.answer = { resolution: "declined" };
    q.status = "answered";
    await saveQuestion(q);
    return NextResponse.json({ question: q });
  }

  if (q.kind === "product_pick") {
    const productId = b?.answer?.productId || (typeof b?.answer === "string" ? b.answer : null);
    if (!productId || typeof productId !== "string") {
      return NextResponse.json({ error: "answer.productId required" }, { status: 400 });
    }
    q.answer = { productId };
    q.status = "answered";
    await saveQuestion(q);
    return NextResponse.json({ question: q });
  }

  if (q.kind === "send_uncertain") {
    if (resolution !== "mark-sent" && resolution !== "send-again") {
      return NextResponse.json({ error: "resolution required: mark-sent | send-again" }, { status: 400 });
    }
    const outboxId = typeof body?.outboxId === "string" ? body.outboxId : null;
    if (!outboxId) return NextResponse.json({ error: "question has no outboxId" }, { status: 409 });
    const row = (await dbFind("outbox", (x: any) => x.id === outboxId))[0];
    if (!row) return NextResponse.json({ error: "outbox row not found" }, { status: 404 });
    if (resolution === "mark-sent") {
      await dbUpdate("outbox", outboxId, { status: "sent", lease_token: null, lease_expires_at: null, finishedAt: Date.now() });
    } else {
      if (row.status === "sent") {
        return NextResponse.json({ error: "already sent; not re-queued" }, { status: 409 });
      }
      await dbUpdate("outbox", outboxId, { status: "queued", lease_token: null, lease_expires_at: null, error: null });
    }
    q.answer = { resolution };
    q.status = "answered";
    await saveQuestion(q);
    return NextResponse.json({ question: q });
  }

  // question / guardrail_block / fee+changes: save answer, queue a draft job.
  const answerText = typeof b?.answer === "string" ? b.answer : "";
  if (!answerText.trim() && q.kind === "question") {
    return NextResponse.json({ error: "answer required" }, { status: 400 });
  }
  q.answer = q.kind === "fee" ? { resolution: "changes", note: answerText.slice(0, 2000) } : answerText.slice(0, 2000);
  q.status = "answered";
  await saveQuestion(q);
  const job = {
    id: uid(),
    type: "draft",
    payload: { questionId: q.id, factoryProductId: q.factoryProductId, answer: q.answer },
    status: "queued" as const,
    leaseToken: null,
    leaseExpiresAt: null,
    attempts: 0,
    error: null,
    createdAt: Date.now(),
  };
  await saveAgentJob(job);
  return NextResponse.json({ question: q, job });
}
