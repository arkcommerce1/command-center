import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { dbFind } from "@/lib/cc/agent-store";
import {
  getFactoryProduct,
  getProduct,
  listFactories,
  listFactoryProductLinks,
  listProducts,
  pgInit,
} from "@/lib/cc/store";
import { normF, normP } from "@/lib/cc/types";

// GET /api/factory-products — read-only enriched rows for the Goal 6 board.
// One row per factory+product link, joined with names + §1.2 flags
// (productGuessed, archivedAt) + pending-approvals count (open agent
// questions + pending agent drafts). Proofs stay on
// GET /api/agent/steps-proof (fetched lazily per row for tooltips).
export async function GET() {
  await pgInit().catch(() => {});
  const [links, products, factoryProducts, questions, drafts] = await Promise.all([
    listFactoryProductLinks().catch(() => []),
    listProducts().catch(() => []),
    // §1.2 rows, keyed by link id when the organizer creates them.
    import("@/lib/cc/store").then((m) => m.listFactoryProducts().catch(() => [])),
    dbFind("questions", (x) => x.status === "open").catch(() => []),
    dbFind("drafts", (x) => x.status === "pending").catch(() => []),
  ]);

  const productById = new Map(products.map(normP).map((p) => [p.id, p]));
  const fpById = new Map(factoryProducts.map((f) => [f.id, f]));
  const openByFp = new Map<string, number>();
  for (const q of questions) {
    const id = String(q.factory_product_id || "");
    if (id) openByFp.set(id, (openByFp.get(id) || 0) + 1);
  }
  const draftsByFp = new Map<string, number>();
  for (const d of drafts) {
    const id = String(d.factory_product_id || "");
    if (id) draftsByFp.set(id, (draftsByFp.get(id) || 0) + 1);
  }

  // Legacy factory names keyed by companyId when a factory row shares the id,
  // else fall back to the raw companyId.
  const allFactories = (
    await Promise.all(products.map((p) => listFactories(p.id).catch(() => [])))
  ).flat().map(normF);
  const factoryById = new Map(allFactories.map((f) => [f.id, f]));

  const rows = await Promise.all(
    links.map(async (l) => {
      const product = productById.get(l.productId) || (await getProduct(l.productId).catch(() => null));
      const fp = fpById.get(l.id) || (await getFactoryProduct(l.id).catch(() => null));
      const factory = factoryById.get(l.companyId);
      return {
        id: l.id,
        companyId: l.companyId,
        companyName: factory?.name || l.companyId,
        productId: l.productId,
        productName: product?.name || l.productId,
        currentLayer: l.currentLayer,
        trackingStage: l.trackingStage,
        statusLine: l.statusLine,
        waitingOn: l.waitingOn,
        since: l.since,
        nextStep: l.nextStep,
        promisedShipDate: l.promisedShipDate,
        dropped: l.dropped,
        productGuessed: fp?.productGuessed ?? false,
        archivedAt: fp?.archivedAt ?? null,
        pendingApprovals: (openByFp.get(l.id) || 0) + (draftsByFp.get(l.id) || 0),
      };
    }),
  );
  return NextResponse.json(rows);
}
