import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { findFactoryByConversation, getUDraft, listUVersions } from "@/lib/cc/actionables-store";
import { dbFind } from "@/lib/cc/agent-store";
import { resolveFeeMessage } from "@/lib/cc/decision-bridge";
import { listDrafts, listProducts, listQuestions } from "@/lib/cc/store";

// GET /api/decisions — the Actionables payload.
// ONE card per factory conversation waiting on Haim (CLAUDE.md "Actionables"
// spec): no internal codes, no separate question-card types, no diffs.
// Merges agent-store rows (Donna's plugin — almost all real data) with
// dashboard-store rows (legacy) by conversation key (factory_product_id).
export async function GET() {
  const [agentDraftsRaw, dashDraftsRaw, agentQuestionsRaw, dashQuestionsRaw, products, agentMessages, agentContacts] =
    await Promise.all([
      dbFind("drafts", (d: any) => d.status === "pending"),
      listDrafts()
        .then((rows) => rows.filter((d) => d.status === "pending"))
        .catch(() => [] as any[]),
      dbFind("questions", (q: any) => q.status === "open" && q.kind !== "sample_flag" && q.kind !== "sample_review"),
      listQuestions()
        .then((rows) =>
          rows.filter((q: any) => q.status === "open" && q.kind !== "sample_flag" && q.kind !== "sample_review"),
        )
        .catch(() => [] as any[]),
      listProducts().catch(() => []),
      dbFind("messages", () => true),
      dbFind("contacts", () => true).catch(() => [] as any[]),
    ]);

  interface Bucket {
    key: string;
    draftIds: { id: string; source: "agent" | "dashboard" }[];
    questions: any[];
  }
  const buckets = new Map<string, Bucket>();
  const bucketFor = (key: string): Bucket => {
    let b = buckets.get(key);
    if (!b) {
      b = { key, draftIds: [], questions: [] };
      buckets.set(key, b);
    }
    return b;
  };
  for (const d of agentDraftsRaw)
    if (d.factory_product_id) bucketFor(d.factory_product_id).draftIds.push({ id: d.id, source: "agent" });
  for (const d of dashDraftsRaw as any[])
    if (d.factoryProductId) bucketFor(d.factoryProductId).draftIds.push({ id: d.id, source: "dashboard" });
  for (const q of agentQuestionsRaw) if (q.factory_product_id) bucketFor(q.factory_product_id).questions.push(q);
  for (const q of dashQuestionsRaw as any[]) if (q.factoryProductId) bucketFor(q.factoryProductId).questions.push(q);

  // Recent + last inbound message per conversation.
  const recentByFp = new Map<string, any[]>();
  for (const m of agentMessages) {
    if (m.direction !== "in" || !m.factory_product_id) continue;
    const list = recentByFp.get(m.factory_product_id) || [];
    list.push(m);
    recentByFp.set(m.factory_product_id, list);
  }

  const contactByName = new Map<string, any>(agentContacts.map((c: any) => [c.name, c]));

  const cards: any[] = [];
  for (const b of buckets.values()) {
    const link = await findFactoryByConversation(b.key);
    const product = link ? products.find((p) => p.id === link.productId) : null;

    let primaryDraft: { id: string; source: "agent" | "dashboard" } | null = b.draftIds[0] || null;
    let versions: Awaited<ReturnType<typeof listUVersions>> = [];
    if (primaryDraft) {
      const ud = await getUDraft(primaryDraft.id);
      if (ud) versions = await listUVersions(ud.id, ud.source);
      else primaryDraft = null;
    }
    const latestVersion = versions.length
      ? versions.reduce((m, v) => (v.versionNumber > (m?.versionNumber ?? -1) ? v : m), versions[0])
      : null;
    const prevVersions = versions.filter((v) => v.id !== latestVersion?.id && v.status !== "pending");

    const chatMsgs = (recentByFp.get(b.key) || []).slice().sort((a, c) => Number(c.sent_at) - Number(a.sent_at));
    const theySaidFromMessages = chatMsgs
      .slice(0, 3)
      .reverse()
      .map((m) => ({ text: m.text || "", translation: m.translation || null }));
    const last = chatMsgs[0];
    const senderName: string | null = last?.sender || null;
    const company: string | null = (senderName && contactByName.get(senderName)?.company) || null;

    const decisionQuestion =
      b.questions.find((q) => q.kind === "fee") ||
      b.questions.find((q) => q.kind === "guardrail_block") ||
      b.questions.find((q) => q.kind === "send_uncertain") ||
      b.questions.find((q) => q.kind === "question");

    let decisionNeeded: string | null = null;
    if (decisionQuestion?.kind === "fee")
      decisionNeeded = `Sample fee — ${resolveFeeMessage(decisionQuestion.body || {})}`;
    else if (decisionQuestion?.kind === "guardrail_block")
      decisionNeeded = `Donna's draft touched a blocked topic (${decisionQuestion.body?.reason || "blocked"}) — tell her what to say instead.`;
    else if (decisionQuestion?.kind === "send_uncertain")
      decisionNeeded = "Not sure the last message to this factory actually sent.";

    let id: string;
    let donnaReply: { bubbles: string[] } | null = null;
    let canApprove = false;
    let canSuggest = false;
    let canDisapprove = false;
    let canIgnore = false;

    if (latestVersion && latestVersion.status === "pending" && primaryDraft) {
      id = `draft:${primaryDraft.id}`;
      donnaReply = { bubbles: latestVersion.bubbles };
      canApprove = true;
      canSuggest = true;
      canDisapprove = true;
      canIgnore = true;
    } else if (decisionQuestion) {
      id = `question:${decisionQuestion.id}`;
      if (decisionQuestion.kind === "fee") {
        canApprove = true;
        canSuggest = true;
        canDisapprove = true;
        canIgnore = true;
      } else if (decisionQuestion.kind === "guardrail_block") {
        canSuggest = true;
        canIgnore = true;
      } else if (decisionQuestion.kind === "send_uncertain") {
        canApprove = true;
        canDisapprove = true;
        canIgnore = true;
      } else {
        canSuggest = true;
        canIgnore = true;
      }
    } else {
      continue; // nothing left waiting on Haim in this conversation
    }

    const theySaid =
      theySaidFromMessages.length > 0
        ? theySaidFromMessages
        : decisionQuestion?.body?.text
          ? [
              {
                text: decisionQuestion.body.text as string,
                translation: (decisionQuestion.body.translation as string) || null,
              },
            ]
          : [];

    cards.push({
      id,
      senderName,
      company,
      time: last?.sent_at
        ? Number(last.sent_at)
        : (latestVersion?.createdAt ?? decisionQuestion?.createdAt ?? Date.now()),
      productId: link?.productId ?? null,
      productName: product?.name ?? null,
      productLinked: Boolean(link),
      allProducts: link ? null : products.map((p) => ({ id: p.id, name: p.name })),
      conversationKey: b.key,
      theySaid,
      donnaReply,
      decisionNeeded,
      previousDrafts: prevVersions.map((v) => ({ bubbles: v.bubbles, outcome: v.status })),
      canApprove,
      canSuggest,
      canDisapprove,
      canIgnore,
    });
  }

  cards.sort((a, b) => a.time - b.time);
  return NextResponse.json({ count: cards.length, cards });
}
