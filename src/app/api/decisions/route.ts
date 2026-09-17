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

// GET /api/decisions — the Actionables page payload: decisions only.
// Pending drafts (messages to approve) + open questions, High importance
// first then oldest. Merges agent-store drafts (created by the plugin) with
// dashboard-store drafts.
export async function GET() {
  const [dashboardDrafts, questions, products, links] = await Promise.all([
    listDrafts().catch(() => []),
    listQuestions().catch(() => []),
    listProducts().catch(() => []),
    listFactoryProductLinks().catch(() => []),
  ]);
  const factories = (await Promise.all(products.map((p) => listFactories(p.id).catch(() => [])))).flat();
  const productById = new Map(products.map((p: any) => [p.id, p]));
  const linkById = new Map(links.map((l: any) => [l.id, l]));
  const factoryById = new Map(factories.map((f: any) => [f.id, f]));

  // Agent-store drafts (created by the plugin) — these have bubbles in draftVersions
  let agentDrafts: any[] = [];
  let agentVersions: any[] = [];
  let agentMessages: any[] = [];
  let agentQuestions: any[] = [];
  try {
    agentDrafts = await dbFind("drafts", (d: any) => d.status === "pending");
    agentVersions = await dbFind("draftVersions", () => true);
    agentMessages = await dbFind("messages", () => true);
    agentQuestions = await dbFind("questions", (q: any) => q.status === "open");
  } catch { /* agent store may not be initialized */ }

  // Build version lookup for agent drafts
  const agentVersionByDraft = new Map<string, any[]>();
  for (const v of agentVersions) {
    const list = agentVersionByDraft.get(v.draft_id) || [];
    list.push(v);
    agentVersionByDraft.set(v.draft_id, list);
  }

  // Last inbound message by factory_product_id
  const lastInboundByFp = new Map<string, any>();
  for (const m of agentMessages) {
    if (m.direction !== "in" || !m.factory_product_id) continue;
    const cur = lastInboundByFp.get(m.factory_product_id);
    if (!cur || Number(m.sent_at) > Number(cur.sent_at)) lastInboundByFp.set(m.factory_product_id, m);
  }

  // Also check last inbound by chat_id (some drafts use chat_id not fp)
  const lastInboundByChat = new Map<string, any>();
  for (const m of agentMessages) {
    if (m.direction !== "in" || !m.chat_id) continue;
    const cur = lastInboundByChat.get(m.chat_id);
    if (!cur || Number(m.sent_at) > Number(cur.sent_at)) lastInboundByChat.set(m.chat_id, m);
  }

  const nameFor = (factoryProductId: string | null, chatId: string | null = null) => {
    const link: any = (factoryProductId && linkById.get(factoryProductId)) || null;
    const product = link ? productById.get(link.productId) : null;
    const factory = link ? factoryById.get(link.companyId) : null;
    return {
      factoryName: factory?.name || null,
      productName: product?.name || null,
      layer: link?.currentLayer ?? null,
    };
  };

  // Draft codes: 1-based index over ALL drafts by creation time
  const allDrafts = [...agentDrafts, ...dashboardDrafts];
  const codeById = new Map<string, number>();
  [...allDrafts]
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || (a.id < b.id ? -1 : 1))
    .forEach((d, i) => codeById.set(d.id, i + 1));

  const cards: any[] = [];

  // Agent-store drafts (with bubbles from versions)
  for (const d of agentDrafts) {
    const versions = agentVersionByDraft.get(d.id) || [];
    const latestVer = versions.sort((a, b) => (b.version || 0) - (a.version || 0))[0];
    const bubbles = latestVer?.bubbles || [];
    const fp = d.factory_product_id || "";
    const chatId = d.chat_id || "";
    const names = nameFor(fp, chatId);
    const last = lastInboundByFp.get(fp) || lastInboundByChat.get(chatId);
    cards.push({
      kind: "message",
      id: d.id,
      code: `D${codeById.get(d.id) || 0}.${latestVer?.version || 1}`,
      importance: "high",
      createdAt: d.createdAt || Date.now(),
      draftType: d.kind || d.type || "reply",
      followup: (d.kind || d.type) === "nudge",
      factoryProductId: fp,
      ...names,
      why: d.reason || d.trigger || null,
      lastMessage: last ? { text: last.text || "", translation: last.translation || null } : null,
      bubbles,
      versions: versions.map((v) => ({
        id: v.id,
        versionNumber: v.version || 1,
        text: (v.bubbles || []).join("\n"),
        bubbles: v.bubbles || [],
        status: v.status || "pending",
        createdBy: v.source || "ai",
        createdAt: v.createdAt || Date.now(),
      })),
    });
  }

  // Dashboard-store drafts
  for (const d of dashboardDrafts.filter((x: any) => x.status === "pending")) {
    const versions = await listDraftVersions(d.id).catch(() => []);
    const names = nameFor(d.factoryProductId);
    const last = lastInboundByFp.get(d.factoryProductId);
    const latest = versions.reduce((m: number, v: any) => Math.max(m, v.versionNumber), 0);
    cards.push({
      kind: "message",
      id: d.id,
      code: `D${codeById.get(d.id) || 0}.${latest}`,
      importance: "high",
      createdAt: d.createdAt,
      draftType: d.type,
      followup: d.type === "nudge",
      factoryProductId: d.factoryProductId,
      ...names,
      why: d.trigger || null,
      lastMessage: last ? { text: last.text || "", translation: last.translation || null } : null,
      bubbles: versions.length > 0 ? (versions[versions.length - 1]?.text || "").split("\n") : [],
      versions: versions.map((v: any) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        text: v.text,
        status: v.status,
        createdBy: v.createdBy,
        createdAt: v.createdAt,
      })),
    });
  }

  // Agent-store questions
  for (const q of agentQuestions) {
    const names = nameFor(q.factory_product_id);
    const body = (q.body ?? {}) as any;
    cards.push({
      kind: q.kind || "question",
      id: q.id,
      importance: q.importance || "medium",
      createdAt: q.createdAt || Date.now(),
      factoryProductId: q.factory_product_id,
      ...names,
      body,
      answer: q.answer ?? null,
    });
  }

  // Dashboard-store questions
  for (const q of questions.filter((x: any) => x.status === "open")) {
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
