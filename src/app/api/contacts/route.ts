import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listContacts, listFactories, listProducts, pgInit, saveContact } from "@/lib/cc/store";
import { Contact, normF, normP, uid } from "@/lib/cc/types";

// GET /api/contacts — unified directory: standalone contacts (Company field)
// + every person attached to a factory (mapped to factory + product).
// Used by both the dashboard UI (no auth) and Donna's poller.
export async function GET() {
  await pgInit();
  const standalone = (await listContacts()).map((c) => ({
    id: c.id, name: c.name, role: c.role, company: c.company,
    wechat: c.wechat, whatsapp: c.whatsapp, email: c.email, notes: c.notes || "",
    factory: "", product: "", source: "contact" as const,
  }));
  const products = (await listProducts()).map(normP);
  const linked: any[] = [];
  for (const p of products) {
    for (const f of (await listFactories(p.id)).map(normF)) {
      for (const pe of (f as any).people || []) {
        linked.push({
          id: pe.id, name: pe.name, role: pe.role || "", company: f.name,
          wechat: pe.wechat || "", whatsapp: pe.whatsapp || "", email: pe.email || "", notes: "",
          factory: f.name, product: p.name, source: "factory" as const,
        });
      }
    }
  }
  return NextResponse.json([...standalone, ...linked]);
}

// POST /api/contacts — add a standalone contact (name, role, company, wechat, whatsapp, email, notes).
export async function POST(req: NextRequest) {
  await pgInit();
  const b = await req.json();
  if (!String(b.name || "").trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  const c: Contact = {
    id: uid(), name: String(b.name).slice(0, 120), role: String(b.role || "").slice(0, 80),
    company: String(b.company || "").slice(0, 120), wechat: String(b.wechat || "").slice(0, 80),
    whatsapp: String(b.whatsapp || "").slice(0, 40), email: String(b.email || "").slice(0, 120),
    notes: String(b.notes || "").slice(0, 500), createdAt: Date.now(),
  };
  await saveContact(c);
  return NextResponse.json(c);
}
