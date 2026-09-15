import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { deleteProduct, getProduct, listFactories, saveProduct } from "@/lib/cc/store";
import { esc, sendEmail } from "@/lib/cc/email";
import { normP } from "@/lib/cc/types";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProduct(id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ product: normP(p), factories: await listFactories(p.id) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProduct(id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json();
  const before = p.stage;
  if (body.name !== undefined) p.name = String(body.name);
  if (body.asin !== undefined) p.asin = String(body.asin);
  if (body.imageUrl !== undefined) p.imageUrl = String(body.imageUrl);
  if (body.fbaSheetUrl !== undefined) (p as any).fbaSheetUrl = String(body.fbaSheetUrl);
  if (body.startDate !== undefined) (p as any).startDate = String(body.startDate);
  if (body.masterSku !== undefined) (p as any).masterSku = String(body.masterSku).slice(0, 60);
  if (body.specDone !== undefined) (p as any).specDone = !!body.specDone;
  if (body.sourcingStarted !== undefined) (p as any).sourcingStarted = !!body.sourcingStarted;
  if (Array.isArray(body.skus))
    (p as any).skus = body.skus.slice(0, 200).map((r: any) => ({
      id: String(r.id || Math.random().toString(36).slice(2, 9)),
      sku: String(r.sku || "").slice(0, 40), size: String(r.size || "").slice(0, 40),
      pack: String(r.pack || "").slice(0, 40), order: String(r.order || "").slice(0, 40),
    }));
  if (body.started !== undefined) {
    p.started = !!body.started;
    if (p.started && p.stage === "idea") { p.stage = "spec"; p.stageUpdatedAt = Date.now(); }
  }
  if (body.stage !== undefined && body.stage !== p.stage) {
    p.stage = body.stage; p.stageUpdatedAt = Date.now();
  }
  if (body.spec) p.spec = { ...p.spec, ...body.spec };
  if (body.costs) p.costs = { ...p.costs, ...body.costs };
  await saveProduct(p);
  if (before !== p.stage) {
    const fs = await listFactories(p.id);
    sendEmail(`Stage change: ${esc(p.name)} → ${esc(p.stage)}`,
      `<p><b>${esc(p.name)}</b> moved from ${esc(before)} to <b>${esc(p.stage)}</b>.</p><p>${fs.length} factorie(s) attached.</p>`).catch(() => {});
  }
  return NextResponse.json(p);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteProduct(id);
  return NextResponse.json({ ok: true });
}
