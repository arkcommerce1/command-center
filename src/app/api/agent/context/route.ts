import { NextRequest, NextResponse } from "next/server";
import { agentAuth } from "@/lib/cc/agent-auth";
import { dbFind } from "@/lib/cc/agent-store";
import { getProduct, getSettings } from "@/lib/cc/store";
import { getFactoryProductLink } from "@/lib/cc/store";

export const dynamic = "force-dynamic";

// GET /api/agent/context?factoryProductId= — everything a drafter needs in one response (§3.2).
export async function GET(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const factoryProductId = req.nextUrl.searchParams.get("factoryProductId") || "";
  if (!factoryProductId) return NextResponse.json({ error: "factoryProductId required" }, { status: 400 });

  const link = await getFactoryProductLink(factoryProductId).catch(() => null);
  const product = link ? await getProduct(link.productId).catch(() => null) : null;
  const settings = await getSettings().catch(() => null);

  const [adjustments, questions, steps, openItems, drafts, messages, contacts] = await Promise.all([
    dbFind("adjustments", (x) => x.factory_product_id === factoryProductId),
    dbFind("questions", (x) => x.factory_product_id === factoryProductId),
    dbFind("steps", (x) => x.factory_product_id === factoryProductId),
    dbFind("openItems", (x) => x.factory_product_id === factoryProductId && !x.resolved_at),
    dbFind("drafts", (x) => x.factory_product_id === factoryProductId),
    dbFind("messages", (x) => x.factory_product_id === factoryProductId),
    dbFind("contacts", (x) => x.factory_product_id === factoryProductId || !x.factory_product_id),
  ]);

  const pendingDraft = drafts.find((d) => d.status === "pending") || null;
  const draftVersions = pendingDraft
    ? await dbFind("draftVersions", (v) => v.draft_id === pendingDraft.id)
    : [];
  const approvedSpec = product && (product as any).specVersions?.length
    ? (product as any).specVersions[(product as any).specVersions.length - 1]
    : null;

  return NextResponse.json({
    product: product ? { id: product.id, name: product.name, approach: (product as any).approach || "already_selling" } : null,
    factory_product: link,
    approved_spec: approvedSpec,
    adjustments,
    prior_claims: questions.filter((q) => ["fee", "product_pick"].includes(q.kind)),
    steps,
    open_items: openItems,
    pending_draft: pendingDraft,
    pending_draft_versions: draftVersions,
    // Last 30 messages placeholder: real message history; older-summary is a stub.
    messages: messages.slice(-30),
    older_messages_summary: messages.length > 30 ? `(${messages.length - 30} older messages omitted)` : null,
    contacts,
    can_share_volumes: false,
    yiwu_address: (settings as any)?.yiwuAddress || "浙江义乌稠城街道丹溪北路18号雪峰银座9楼912室 丁小姐 15067460724",
    style_examples: [],
  });
}
