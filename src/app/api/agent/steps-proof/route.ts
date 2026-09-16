import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { dbFind } from "@/lib/cc/agent-store";
import { getFactoryProduct, getFactoryProductLink, listLayerProofs, pgInit } from "@/lib/cc/store";

// GET /api/agent/steps-proof?factoryProductId= — read-only proof data for the
// Goal 6 Factories board + factory summary page (5 step dots with proof links).
// NOTE: intentionally NOT behind agentAuth: dashboard browsers carry no bearer
// token. Same precedent as GET /api/messages (login-gated by the proxy, not an
// agent route). Read-only; it never writes.
export async function GET(req: NextRequest) {
  await pgInit().catch(() => {
    // Local file-backed store needs no init; keep serving.
  });
  const factoryProductId = req.nextUrl.searchParams.get("factoryProductId") || "";
  if (!factoryProductId) return NextResponse.json({ error: "factoryProductId required" }, { status: 400 });

  const [agentSteps, layerProofs, messages, chats, contacts, fp] = await Promise.all([
    dbFind("steps", (x) => x.factory_product_id === factoryProductId).catch(() => []),
    listLayerProofs(factoryProductId).catch(() => []),
    dbFind("messages", () => true).catch(() => []),
    dbFind("chats", () => true).catch(() => []),
    dbFind("contacts", () => true).catch(() => []),
    getFactoryProduct(factoryProductId).catch(() => null),
  ]);

  const msgById = new Map(messages.map((m: any) => [m.id, m]));
  const chatById = new Map(chats.map((c: any) => [c.id, c]));
  const contactById = new Map(contacts.map((c: any) => [c.id, c]));

  const byStep = new Map<number, any>();
  for (const s of agentSteps) {
    const n = Number(s.step);
    if (n >= 1 && n <= 5 && !byStep.has(n)) byStep.set(n, s);
  }
  for (const p of layerProofs) {
    const n = Number((p as any).layer);
    if (n >= 1 && n <= 5 && !byStep.has(n)) {
      byStep.set(n, { step: n, proof_message_id: null, done_at: (p as any).markedAt, text: (p as any).messageText });
    }
  }

  const proofs = [1, 2, 3, 4, 5].map((step) => {
    const s = byStep.get(step);
    if (!s) return { step, done: false, messageId: null, text: null, translation: null, sentAt: null, chatName: null };
    const proofId = s.proof_message_id || s.proofMessageId || null;
    const m = proofId ? msgById.get(proofId) : null;
    const chat = m ? chatById.get(m.chat_id) : null;
    const sender = m?.contact_id ? contactById.get(m.contact_id) : null;
    return {
      step,
      done: true,
      messageId: proofId,
      text: m?.text || s.text || null,
      translation: m?.translation || null,
      sentAt: m?.sent_at ?? s.done_at ?? null,
      chatName: chat?.name || chat?.external_id || null,
      sender: sender?.name || null,
    };
  });

  const [openQuestions, pendingDrafts] = await Promise.all([
    dbFind("questions", (x) => x.factory_product_id === factoryProductId && x.status === "open").catch(() => []),
    dbFind("drafts", (x) => x.factory_product_id === factoryProductId && x.status === "pending").catch(() => []),
  ]);

  // §1.2 factoryProducts row (organizer-owned) carries guessed + archived flags.
  const link = await getFactoryProductLink(factoryProductId).catch(() => null);
  return NextResponse.json({
    factoryProductId,
    proofs,
    productGuessed: fp?.productGuessed ?? false,
    archivedAt: fp?.archivedAt ?? null,
    legacyDropped: (link as any)?.dropped ?? null,
    pendingApprovals: openQuestions.length + pendingDrafts.length,
    openQuestions: openQuestions.length,
    pendingDrafts: pendingDrafts.length,
  });
}
