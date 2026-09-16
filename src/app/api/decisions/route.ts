import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { dbFind } from "@/lib/cc/agent-store";
import { resolveFeeMessage } from "@/lib/cc/decision-bridge";
import {
  listDrafts,
  listDraftVersions,
  listFactories,
  listFactoryProductLinks,
  listProducts,
  listQuestions,
} from "@/lib/cc/store";

// GET /api/decisions — the Actionables page payload (Goal 7): decisions only.
// Pending drafts (messages to approve) + open questions, High importance
// first then oldest. Login-gated by the proxy.
export async function GET() {
  const [drafts, questions, products, links] = await Promise.all([
    listDrafts(),
    listQuestions(),
    listProducts(),
    listFactoryProductLinks(),
  ]);
  const factories = (await Promise.all(products.map((p) => listFactories(p.id).catch(() => [])))).flat();
  const productById = new Map(products.map((p: any) => [p.id, p]));
  const linkById = new Map(links.map((l: any) => [l.id, l]));
  const factoryById = new Map(factories.map((f: any) => [f.id, f]));

  // Agent-store messages for last-message-translated.
  const agentMessages: any[] = await dbFind("messages", () => true).catch(() => []);
  const lastInboundByFp = new Map<string, any>();
  for (const m of agentMessages) {
    if (m.direction !== "in" || !m.factory_product_id) continue;
    const cur = lastInboundByFp.get(m.factory_product_id);
    if (!cur || Number(m.sent_at) > Number(cur.sent_at)) lastInboundByFp.set(m.factory_product_id, m);
  }

  const nameFor = (factoryProductId: string | null) => {
    const link: any = (factoryProductId && linkById.get(factoryProductId)) || null;
    const product = link ? productById.get(link.productId) : null;
    const factory = link ? factoryById.get(link.companyId) : null;
    return {
      factoryName: factory?.name || null,
      productName: product?.name || null,
      layer: link?.currentLayer ?? null,
    };
  };

  // Draft codes are stable: 1-based index over ALL drafts by creation time.
  const codeById = new Map<string, number>();
  [...drafts]
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    .forEach((d, i) => codeById.set(d.id, i + 1));

  const cards: any[] = [];

  for (const d of drafts.filter((x) => x.status === "pending")) {
    const versions = await listDraftVersions(d.id);
    const names = nameFor(d.factoryProductId);
    const last = lastInboundByFp.get(d.factoryProductId);
    const latest = versions.reduce((m, v) => Math.max(m, v.versionNumber), 0);
    cards.push({
      kind: "message",
      id: d.id,
      code: `D${codeById.get(d.id)}.${latest}`,
      importance: "high",
      createdAt: d.createdAt,
      draftType: d.type,
      followup: d.type === "nudge",
      factoryProductId: d.factoryProductId,
      ...names,
      why: d.trigger || null,
      lastMessage: last ? { text: last.text || "", translation: last.translation || null } : null,
      versions: versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        text: v.text,
        suggestionText: v.suggestionText,
        status: v.status,
        createdBy: v.createdBy,
        createdAt: v.createdAt,
      })),
    });
  }

  for (const q of questions.filter((x) => x.status === "open")) {
    const names = nameFor(q.factoryProductId);
    const body = (q.body ?? {}) as any;
    const card: any = {
      kind: q.kind,
      id: q.id,
      importance: q.importance,
      createdAt: q.createdAt,
      factoryProductId: q.factoryProductId,
      ...names,
      body,
      answer: q.answer ?? null,
    };
    if (q.kind === "fee") card.feeMessage = resolveFeeMessage(body);
    cards.push(card);
  }

  const rank = (i: string) => (i === "high" ? 0 : i === "medium" ? 1 : 2);
  cards.sort((a, b) => rank(a.importance) - rank(b.importance) || a.createdAt - b.createdAt);

  const toApprove = cards.filter((c) => c.kind === "message").length;
  const samples = cards.filter((c) => c.kind === "sample_flag" || c.kind === "sample_review").length;
  const qs = cards.length - toApprove - samples;

  return NextResponse.json({ counts: { toApprove, questions: qs, samples }, cards });
}
