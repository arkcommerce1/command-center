import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { dbFind } from "@/lib/cc/agent-store";
import {
  listDrafts,
  listDraftVersions,
  listFactories,
  listFactoryProductLinks,
  listProducts,
} from "@/lib/cc/store";

// GET /api/decisions — Actionables page payload.
// Goal 2 redesign: ONLY message cards (pending drafts). No question cards,
// no product_pick cards, no fee cards. Only the newest version shows.
// Each card includes: sender name, company, time, product, "They said", "Donna will reply".
export async function GET() {
  const [dashboardDrafts, products, links] = await Promise.all([
    listDrafts().catch(() => []),
    listProducts().catch(() => []),
    listFactoryProductLinks().catch(() => []),
  ]);
  const factories = (await Promise.all(products.map((p) => listFactories(p.id).catch(() => [])))).flat();
  const productById = new Map(products.map((p: any) => [p.id, p]));
  const linkById = new Map(links.map((l: any) => [l.id, l]));
  const factoryById = new Map(factories.map((f: any) => [f.id, f]));

  // Agent-store data
  let agentDrafts: any[] = [];
  let agentVersions: any[] = [];
  let agentMessages: any[] = [];
  let agentContacts: any[] = [];
  let agentChatMembers: any[] = [];
  let agentFactories: any[] = [];
  try {
    agentDrafts = await dbFind("drafts", (d: any) => d.status === "pending");
    agentVersions = await dbFind("draftVersions", () => true);
    agentMessages = await dbFind("messages", (m: any) => m.direction === "in");
    agentContacts = await dbFind("contacts", () => true);
    agentChatMembers = await dbFind("chatMembers", () => true);
    agentFactories = await dbFind("factories", () => true);
  } catch { /* agent store may not be initialized */ }

  // Build version lookup: only the LATEST version per draft
  const latestVersionByDraft = new Map<string, any>();
  for (const v of agentVersions) {
    const existing = latestVersionByDraft.get(v.draft_id);
    if (!existing || (v.version || 0) > (existing.version || 0)) {
      latestVersionByDraft.set(v.draft_id, v);
    }
  }

  // Last inbound message by factory_product_id
  const lastInboundByFp = new Map<string, any>();
  for (const m of agentMessages) {
    if (m.direction !== "in" || !m.factory_product_id) continue;
    const cur = lastInboundByFp.get(m.factory_product_id);
    if (!cur || Number(m.sent_at) > Number(cur.sent_at)) lastInboundByFp.set(m.factory_product_id, m);
  }

  // Also by chat_id
  const lastInboundByChat = new Map<string, any>();
  for (const m of agentMessages) {
    if (m.direction !== "in" || !m.chat_id) continue;
    const cur = lastInboundByChat.get(m.chat_id);
    if (!cur || Number(m.sent_at) > Number(cur.sent_at)) lastInboundByChat.set(m.chat_id, m);
  }

  // Contact lookup by factory_product_id (sender name + company)
  const contactByFp = new Map<string, any>();
  for (const c of agentContacts) {
    if (c.factory_product_id) contactByFp.set(c.factory_product_id, c);
  }

  // Factory lookup by id (for factory name)
  const agentFactoryById = new Map(agentFactories.map((f: any) => [f.id, f]));
  // Chat lookup by chat_id (for factory name fallback)
  const agentChats: any[] = [];
  try {
    agentChats = await dbFind("chats", () => true);
  } catch { /* agent store may not be initialized */ }
  const chatByExtId = new Map(agentChats.map((c: any) => [c.external_id, c]));

  // Dashboard-store name resolution
  const nameFor = (factoryProductId: string | null) => {
    const link: any = (factoryProductId && linkById.get(factoryProductId)) || null;
    const product = link ? productById.get(link.productId) : null;
    const factory = link ? factoryById.get(link.companyId) : null;
    const agentFactory = (factoryProductId && agentFactoryById.get(factoryProductId)) || null;
    // If the factory name is a JID (all digits), try to get the chat name
    let factoryName = factory?.name || agentFactory?.name || null;
    if (factoryName && /^\d+$/.test(factoryName)) {
      // Look up the chat name
      for (const c of agentChats) {
        if (c.id === agentFactory?.chat_id || c.external_id?.includes(factoryName)) {
          if (c.name && !/^\d+$/.test(c.name)) {
            factoryName = c.name;
            break;
          }
        }
      }
    }
    return {
      factoryName,
      productName: product?.name || null,
    };
  };

  const cards: any[] = [];

  // Agent-store drafts (only the newest version)
  for (const d of agentDrafts) {
    const latest = latestVersionByDraft.get(d.id);
    if (!latest) continue;
    const bubbles = latest.bubbles || [];
    const fp = d.factory_product_id || "";
    const chatId = d.chat_id || "";
    const names = nameFor(fp || null);
    const last = lastInboundByFp.get(fp) || lastInboundByChat.get(chatId);
    const contact = contactByFp.get(fp);

    // Sender name: prefer contact name, then message sender_name, then factory name
    const senderName = contact?.name || last?.sender_name || last?.sender || names.factoryName || "Unknown sender";
    const company = contact?.company || "";

    cards.push({
      kind: "message",
      id: d.id,
      factoryProductId: fp || null,
      factoryName: names.factoryName,
      productName: names.productName,
      lastMessage: last ? {
        text: last.text || "",
        translation: last.translation || null,
        sender: senderName,
        company,
        time: Number(last.sent_at) || null,
      } : null,
      bubbles,
      versions: [{
        id: latest.id,
        versionNumber: latest.version || 1,
        text: (bubbles || []).join("\n\n"),
        bubbles: bubbles || [],
        status: latest.status || "pending",
      }],
    });
  }

  // Dashboard-store drafts (only pending, only newest version)
  for (const d of dashboardDrafts.filter((x: any) => x.status === "pending")) {
    const versions = await listDraftVersions(d.id).catch(() => []);
    if (versions.length === 0) continue;
    const latest = versions.reduce((m: any, v: any) => v.versionNumber > (m?.versionNumber || 0) ? v : m, versions[0]);
    const names = nameFor(d.factoryProductId);
    const last = lastInboundByFp.get(d.factoryProductId);
    const contact = contactByFp.get(d.factoryProductId);
    const senderName = contact?.name || last?.sender_name || names.factoryName || "Unknown sender";
    const company = contact?.company || "";

    cards.push({
      kind: "message",
      id: d.id,
      factoryProductId: d.factoryProductId || null,
      factoryName: names.factoryName,
      productName: names.productName,
      lastMessage: last ? {
        text: last.text || "",
        translation: last.translation || null,
        sender: senderName,
        company,
        time: Number(last.sent_at) || null,
      } : null,
      bubbles: latest.text ? latest.text.split("\n") : [],
      versions: [{
        id: latest.id,
        versionNumber: latest.versionNumber,
        text: latest.text,
        bubbles: latest.text ? latest.text.split("\n") : [],
        status: latest.status,
      }],
    });
  }

  // Sort by creation time (newest first)
  cards.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));

  const toApprove = cards.length;

  return NextResponse.json({
    counts: { toApprove, questions: 0, samples: 0 },
    cards,
  });
}
