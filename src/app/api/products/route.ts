import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listProducts, pgInit, saveProduct } from "@/lib/cc/store";
import { blankCosts, blankSpec, normP, Product, uid } from "@/lib/cc/types";

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
  return NextResponse.json(list);
}

export async function POST(req: NextRequest) {
  await pgInit();
  const body = await req.json();
  const now = Date.now();
  const p: Product = {
    id: uid(), name: String(body.name || "Untitled"), started: false,
    stage: "idea", stageUpdatedAt: now, createdAt: now,
    asin: String(body.asin || ""), imageUrl: String(body.imageUrl || ""), fbaSheetUrl: "", startDate: "",
    spec: blankSpec(), costs: blankCosts(),
  };
  await saveProduct(p);
  return NextResponse.json(p);
}
