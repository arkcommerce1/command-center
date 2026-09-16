import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { dbFind } from "@/lib/cc/agent-store";
import {
  getFactoryProductLink,
  getProduct,
  listAdjustments,
  listChats,
  listChatMembers,
  listContactChannels,
  listContacts,
  listFactories,
  listFactoryProductLinks,
  listMessages,
  listOpenItems,
  listProducts,
  listQuotes,
  listSamples,
  pgInit,
} from "@/lib/cc/store";
import { normF, normP } from "@/lib/cc/types";

// GET /api/factories/[fid]/summary — read-only bundle for the Goal 6 factory
// summary page. [fid] is a companyId (board grouping key); a link id is also
// accepted and resolved to its company. Never writes.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ fid: string }> }) {
  await pgInit().catch(() => {});
  const { fid } = await params;
  if (!fid) return NextResponse.json({ error: "fid required" }, { status: 400 });

  const [allLinks, products] = await Promise.all([
    listFactoryProductLinks().catch(() => []),
    listProducts().catch(() => []),
  ]);
  const linkById = allLinks.find((l) => l.id === fid);
  const companyId = linkById ? linkById.companyId : fid;
  const links = allLinks.filter((l) => l.companyId === companyId);
  if (links.length === 0 && !linkById) return NextResponse.json({ error: "not found" }, { status: 404 });

  const productById = new Map(products.map(normP).map((p) => [p.id, p]));
  const fpIds = links.map((l) => l.id);
  const fpIdSet = new Set(fpIds);

  const [
    storeAdjustments,
    storeOpenItems,
    storeQuotes,
    storeSamples,
    storeMessages,
    storeChats,
    storeContacts,
    agentMessages,
    agentChats,
    agentContacts,
    agentAdjustments,
    agentOpenItems,
    agentQuotes,
    agentSamples,
    agentSteps,
    agentQuestions,
    agentDrafts,
  ] = await Promise.all([
    Promise.all(fpIds.map((id) => listAdjustments(id).catch(() => []))).then((a) => a.flat()),
    Promise.all(fpIds.map((id) => listOpenItems(id).catch(() => []))).then((a) => a.flat()),
    Promise.all(fpIds.map((id) => listQuotes(id).catch(() => []))).then((a) => a.flat()),
    Promise.all(fpIds.map((id) => listSamples(id).catch(() => []))).then((a) => a.flat()),
    listMessages().catch(() => []),
    listChats().catch(() => []),
    listContacts().catch(() => []),
    dbFind("messages", () => true).catch(() => []),
    dbFind("chats", () => true).catch(() => []),
    dbFind("contacts", () => true).catch(() => []),
    dbFind("adjustments", (x) => fpIdSet.has(String(x.factory_product_id))).catch(() => []),
    dbFind("openItems", (x) => fpIdSet.has(String(x.factory_product_id)) && !x.resolved_at).catch(() => []),
    dbFind("quotes", (x) => fpIdSet.has(String(x.factory_product_id))).catch(() => []),
    dbFind("samples", (x) => fpIdSet.has(String(x.factory_product_id))).catch(() => []),
    dbFind("steps", (x) => fpIdSet.has(String(x.factory_product_id))).catch(() => []),
    dbFind("questions", (x) => fpIdSet.has(String(x.factory_product_id))).catch(() => []),
    dbFind("drafts", (x) => fpIdSet.has(String(x.factory_product_id))).catch(() => []),
  ]);

  // Legacy factory rows: company name resolves from a row whose id matches, else links.
  const allFactories = (await Promise.all(products.map((p) => listFactories(p.id).catch(() => []))))
    .flat()
    .map(normF);
  const byIdFactory = allFactories.find((f) => f.id === companyId);
  const companyName = byIdFactory?.name || "";
  const factoryRows = allFactories.filter((f) => f.id === companyId || (companyName && f.name === companyName));

  const agentChatById = new Map(agentChats.map((c: any) => [c.id, c]));
  const agentContactById = new Map(agentContacts.map((c: any) => [c.id, c]));
  const companyChats = agentChats.filter(
    (c: any) => c.factory_id === companyId || (companyName && c.name === companyName),
  );
  const companyChatIds = new Set(companyChats.map((c: any) => c.id));

  const scopedAgentMessages = agentMessages.filter(
    (m: any) => fpIdSet.has(String(m.factory_product_id || "")) || companyChatIds.has(m.chat_id),
  );
  const timeline = scopedAgentMessages
    .map((m: any) => {
      const chat = agentChatById.get(m.chat_id);
      const sender = m.contact_id ? agentContactById.get(m.contact_id) : null;
      return {
        id: m.id,
        text: m.text || "",
        translation: m.translation || "",
        direction: m.direction || "in",
        sender: sender?.name || "",
        chatName: chat?.name || chat?.external_id || "",
        sentAt: m.sent_at ?? m.createdAt ?? null,
        factoryProductId: m.factory_product_id || null,
      };
    })
    .sort((a, b) => (Number(a.sentAt) || 0) - (Number(b.sentAt) || 0));

  const outbound = timeline.filter((m) => m.direction === "out");

  const stepsByFp = new Map<string, any[]>();
  for (const s of agentSteps) {
    const id = String(s.factory_product_id);
    if (!stepsByFp.has(id)) stepsByFp.set(id, []);
    stepsByFp.get(id)!.push(s);
  }
  const agentMsgById = new Map(agentMessages.map((m: any) => [m.id, m]));
  const proofsByFp: Record<string, { step: number; done: boolean; messageId: string | null; text: string | null; translation: string | null; sentAt: number | null }[]> = {};
  for (const l of links) {
    const byStep = new Map<number, any>();
    for (const s of stepsByFp.get(l.id) || []) {
      const n = Number(s.step);
      if (n >= 1 && n <= 5 && !byStep.has(n)) byStep.set(n, s);
    }
    proofsByFp[l.id] = [1, 2, 3, 4, 5].map((step) => {
      const s = byStep.get(step);
      if (!s) return { step, done: false, messageId: null, text: null, translation: null, sentAt: null };
      const m = s.proof_message_id ? agentMsgById.get(s.proof_message_id) : null;
      return {
        step,
        done: true,
        messageId: s.proof_message_id || null,
        text: m?.text || null,
        translation: m?.translation || null,
        sentAt: m?.sent_at ?? s.done_at ?? null,
      };
    });
  }

  const memberContacts = await listChatMembers().catch(() => []);
  void memberContacts;
  const channels = await listContactChannels().catch(() => []);
  void channels;

  const items = await Promise.all(
    links.map(async (l) => {
      const product = productById.get(l.productId) || (await getProduct(l.productId).catch(() => null));
      const { getFactoryProduct } = await import("@/lib/cc/store");
      const fp = await getFactoryProduct(l.id).catch(() => null);
      return {
        link: l,
        product: product ? { id: product.id, name: product.name } : { id: l.productId, name: l.productId },
        productGuessed: fp?.productGuessed ?? false,
        archivedAt: fp?.archivedAt ?? null,
        proofs: proofsByFp[l.id],
        openItems: [
          ...storeOpenItems.filter((o) => o.factoryProductId === l.id).map((o) => ({ id: o.id, summary: o.summary, direction: o.direction, kind: o.kind, openedAt: o.openedAt, source: "store" as const })),
          ...agentOpenItems.filter((o: any) => String(o.factory_product_id) === l.id).map((o: any) => ({ id: o.id, summary: o.summary || "", direction: o.direction || "", kind: o.kind || "", openedAt: o.opened_at || o.createdAt || null, source: "agent" as const })),
        ],
        adjustments: [
          ...storeAdjustments.filter((a) => a.factoryProductId === l.id).map((a) => ({ id: a.id, fieldKey: a.fieldKey, proposedValue: a.proposedValue, result: a.result, source: "store" as const })),
          ...agentAdjustments.filter((a: any) => String(a.factory_product_id) === l.id).map((a: any) => ({ id: a.id, fieldKey: a.field_key || "", proposedValue: a.proposed_value || "", result: a.result || "pending", source: "agent" as const })),
        ],
        quotes: [
          ...storeQuotes.filter((q) => q.factoryProductId === l.id).map((q) => ({ id: q.id, text: q.text, createdAt: q.createdAt })),
          ...agentQuotes.filter((q: any) => String(q.factory_product_id) === l.id).map((q: any) => ({ id: q.id, text: q.text || "", createdAt: q.createdAt || null })),
        ],
        samples: [
          ...storeSamples.filter((s) => s.factoryProductId === l.id).map((s) => ({ id: s.id, stage: s.stage, qcResult: s.qcResult, haimResult: s.haimResult, source: "store" as const })),
          ...agentSamples.filter((s: any) => String(s.factory_product_id) === l.id).map((s: any) => ({ id: s.id, stage: s.stage || "", qcResult: s.qc_result || null, haimResult: s.haim_result || null, source: "agent" as const })),
        ],
        pendingApprovals:
          agentQuestions.filter((q: any) => String(q.factory_product_id) === l.id && q.status === "open").length +
          agentDrafts.filter((d: any) => String(d.factory_product_id) === l.id && d.status === "pending").length,
      };
    }),
  );

  const refLink = linkById || links[0];
  const refProduct = refLink
    ? productById.get(refLink.productId) || (await getProduct(refLink.productId).catch(() => null))
    : null;
  void refProduct;
  const legacyLink = refLink ? await getFactoryProductLink(refLink.id).catch(() => null) : null;
  void legacyLink;

  const contacts = [
    ...factoryRows.flatMap((f) => ((f as any).people || []).map((p: any) => ({ id: p.id, name: p.name, role: p.role || "", channels: [p.wechat && `wechat:${p.wechat}`, p.whatsapp && `whatsapp:${p.whatsapp}`, p.email && `email:${p.email}`].filter(Boolean) as string[], source: "factory-person" as const }))),
    ...storeContacts
      .filter((c) => companyName && c.company === companyName)
      .map((c) => ({ id: c.id, name: c.name, role: c.role || "", channels: [`wechat:${c.wechat}`, `whatsapp:${c.whatsapp}`, `email:${c.email}`].filter((x) => !x.endsWith(":")), source: "contact" as const })),
  ];

  return NextResponse.json({
    companyId,
    companyName: companyName || companyId,
    factoryRowIds: factoryRows.map((f) => f.id),
    canShareVolumes: factoryRows.some((f) => !!(f as any).canShareVolumes),
    items,
    outbound,
    timeline,
    contacts,
    storeMessages: storeMessages
      .filter((m) => fpIdSet.has(m.factoryProductId || "") || storeChats.some((c) => c.id === m.chatId && companyName && c.name === companyName))
      .slice(-100)
      .map((m) => ({ id: m.id, text: m.text, translation: m.translation, direction: m.direction, sentAt: m.sentAt })),
  });
}
