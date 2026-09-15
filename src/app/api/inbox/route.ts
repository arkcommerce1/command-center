import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listFactories, listProducts, saveFactory, saveProduct } from "@/lib/cc/store";
import { normF, normP, uid, type Factory } from "@/lib/cc/types";

// Donna's inbox: WhatsApp updates land on the dashboard.
// POST /api/inbox  Authorization: Bearer $CRON_SECRET
// { product, factory?, comment?, specUpdate?, reminder?: {date,text},
//   sampleStatus?, quoteStatus?, fstage?, ping?: true,
//   newFactory?: {name, contact?} }
export async function POST(req: NextRequest) {
  if (process.env.CRON_SECRET) {
    if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const b = await req.json();
  const pq = String(b.product || "").toLowerCase();
  if (!pq) return NextResponse.json({ error: "product required" }, { status: 400 });
  const products = (await listProducts()).map(normP);
  const p = products.find((x) => x.name.toLowerCase() === pq || (x.asin && x.asin.toLowerCase() === pq))
    || products.find((x) => x.name.toLowerCase().includes(pq) || pq.includes(x.name.toLowerCase()));
  if (!p) return NextResponse.json({ error: "product not found", products: products.map((x) => x.name) }, { status: 404 });
  const done: string[] = [];
  if (b.specUpdate !== undefined) {
    p.spec.lastUpdate = `${new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric" })} ${String(b.specUpdate).slice(0, 500)}`;
    done.push("spec-update");
  }
  await saveProduct(p);
  if (b.newFactory?.name) {
    const fac: Factory = {
      id: uid(), productId: p.id, name: String(b.newFactory.name).slice(0, 120),
      contact: String(b.newFactory.contact || ""), channel: "WeChat",
      active: true, fstage: "intro", sampleStatus: "none", quoteStatus: "none",
      people: [],
      lastContactAt: Date.now(), sampleRequestedAt: null, sampleShippedAt: null,
      reminders: [], comments: b.newFactory.note
        ? [{ ts: Date.now(), text: "Added via Donna: " + String(b.newFactory.note).slice(0, 500) }] : [],
      files: [], quotes: [], updatedAt: Date.now(),
    };
    await saveFactory(fac);
    return NextResponse.json({ ok: true, product: p.name, factory: fac.name, done: [...done, "new-factory"] });
  }
  const fq = String(b.factory || "").toLowerCase();
  if (fq) {
    const fs = (await listFactories(p.id)).map(normF);
    const f = fs.find((x) => x.name.toLowerCase() === fq)
      || fs.find((x) => x.name.toLowerCase().includes(fq) || fq.includes(x.name.toLowerCase()));
    if (!f) return NextResponse.json({ error: "factory not found", factories: fs.map((x) => x.name), done }, { status: 404 });
    if (b.comment) { f.comments.unshift({ ts: Date.now(), text: String(b.comment).slice(0, 2000) }); done.push("comment"); }
    if (b.sampleStatus) f.sampleStatus = b.sampleStatus;
    if (b.quoteStatus) f.quoteStatus = b.quoteStatus;
    if (b.fstage) (f as any).fstage = b.fstage;
    if (b.sampleStatus || b.quoteStatus || b.fstage) done.push("status");
    if (b.ping) { f.lastContactAt = Date.now(); done.push("ping"); }
    if (b.reminder?.date && b.reminder?.text)
      { f.reminders.push({ id: Math.random().toString(36).slice(2, 9), date: String(b.reminder.date), text: String(b.reminder.text).slice(0, 500), done: false }); done.push("reminder"); }
    await saveFactory(f);
    return NextResponse.json({ ok: true, product: p.name, factory: f.name, done });
  }
  return NextResponse.json({ ok: true, product: p.name, done });
}
