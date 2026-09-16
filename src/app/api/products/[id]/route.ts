import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { deleteProduct, getProduct, listFactories, saveProduct } from "@/lib/cc/store";
import { esc, sendEmail } from "@/lib/cc/email";
import { normP, normSpecField, SpecField } from "@/lib/cc/types";

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
  const beforeSpecDone = !!(p as any).specDone;
  if (body.name !== undefined) p.name = String(body.name);
  if (body.asin !== undefined) p.asin = String(body.asin);
  if (body.imageUrl !== undefined) p.imageUrl = String(body.imageUrl);
  if (body.fbaSheetUrl !== undefined) (p as any).fbaSheetUrl = String(body.fbaSheetUrl);
  if (body.startDate !== undefined) (p as any).startDate = String(body.startDate);
  if (body.masterSku !== undefined) (p as any).masterSku = String(body.masterSku).slice(0, 60);
  if (body.specDone !== undefined) (p as any).specDone = !!body.specDone;
  if (body.sourcingStarted !== undefined) (p as any).sourcingStarted = !!body.sourcingStarted;
  if (body.productStatus !== undefined && ["queue", "active", "completed"].includes(body.productStatus))
    (p as any).productStatus = body.productStatus;
  if (body.estimatedMonthlySales !== undefined)
    (p as any).estimatedMonthlySales = Math.max(0, Math.round(Number(body.estimatedMonthlySales)) || 0);
  if (body.averagePricePerUnit !== undefined)
    (p as any).averagePricePerUnit = Math.max(0, Number(body.averagePricePerUnit) || 0);
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
  if (body.spec) {
    const specChanged = body.spec.notes !== undefined && body.spec.notes !== p.spec.notes;
    p.spec = { ...p.spec, ...body.spec };
    if (specChanged) (p as any).specUpdatedAt = Date.now();
  }
  if (body.costs) p.costs = { ...p.costs, ...body.costs };
  if (body.yukiChecklist) (p as any).yukiChecklist = { ...(p as any).yukiChecklist, ...body.yukiChecklist };
  if (body.boxCutoffDate !== undefined) (p as any).boxCutoffDate = String(body.boxCutoffDate);
  if (Array.isArray(body.yukiBriefs))
    (p as any).yukiBriefs = body.yukiBriefs.slice(0, 200).map((b: any) => ({
      version: Number(b.version) || 0,
      sentAt: Number(b.sentAt) || Date.now(),
      content: String(b.content || "").slice(0, 20000),
    }));
  if (body.specDone !== undefined && !!body.specDone !== beforeSpecDone) (p as any).specUpdatedAt = Date.now();
  // Structured spec fields: plain save (no new version) — used for in-progress edits.
  if (Array.isArray(body.specFields)) {
    (p as any).specFields = body.specFields.slice(0, 200).map((f: any) => normSpecField(f));
  }
  // approveSpecVersion: true -> snapshot the current (or provided) field set as a new version.
  if (body.approveSpecVersion) {
    const fields: SpecField[] = (
      Array.isArray(body.specFields) ? body.specFields : (p as any).specFields || []
    )
      .slice(0, 200)
      .map((f: any) => normSpecField(f));
    (p as any).specFields = fields;
    const nextVersion = ((p as any).specVersion || 0) + 1;
    (p as any).specVersion = nextVersion;
    (p as any).specVersions = [
      ...((p as any).specVersions || []),
      { version: nextVersion, fields, createdAt: Date.now() },
    ];
  }
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
