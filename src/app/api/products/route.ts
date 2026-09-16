import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listFactories, listProducts, pgInit, saveProduct } from "@/lib/cc/store";
import { blankCosts, blankSpec, FSTAGES, FSTAGE_LABEL, normF, normP, Product, uid } from "@/lib/cc/types";

export async function GET() {
  await pgInit();
  const today = new Date().toISOString().slice(0, 10);
  const list = (await listProducts()).map(normP);
  for (const p of list as any[]) {
    if (!p.started && p.startDate && p.startDate <= today) {
      p.started = true;
      await saveProduct(p);
    }
  }
  // Best-effort per-product factory summary for the list view (count + furthest stage).
  const withFactories = await Promise.all(
    (list as any[]).map(async (p) => {
      const factories = (await listFactories(p.id)).map(normF);
      let furthestIdx = -1;
      for (const f of factories) {
        const idx = FSTAGES.indexOf(f.fstage);
        if (idx > furthestIdx) furthestIdx = idx;
      }
      return {
        ...p,
        factoriesCount: factories.length,
        furthestFactoryStage: furthestIdx >= 0 ? FSTAGES[furthestIdx] : null,
        furthestFactoryStageLabel: furthestIdx >= 0 ? FSTAGE_LABEL[FSTAGES[furthestIdx]] : null,
      };
    })
  );
  return NextResponse.json(withFactories);
}

export async function POST(req: NextRequest) {
  await pgInit();
  const body = await req.json();
  const now = Date.now();
  const p: Product = normP({
    id: uid(), name: String(body.name || "Untitled"), started: false,
    stage: "idea", stageUpdatedAt: now, createdAt: now,
    asin: String(body.asin || ""), imageUrl: String(body.imageUrl || ""), fbaSheetUrl: "", startDate: "",
    masterSku: "", skus: [], specDone: false, sourcingStarted: false,
    spec: blankSpec(), costs: blankCosts(),
  } as unknown as Product);
  await saveProduct(p);
  return NextResponse.json(p);
}
