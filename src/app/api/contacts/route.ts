import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listFactories, listProducts } from "@/lib/cc/store";
import { normF, normP } from "@/lib/cc/types";

// Donna's directory: every person at every factory, with channels.
// GET /api/contacts  Authorization: Bearer $CRON_SECRET
// → [{ name, role, wechat, whatsapp, email, factory, product }]
export async function GET(req: NextRequest) {
  if (process.env.CRON_SECRET) {
    if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const products = (await listProducts()).map(normP);
  const out: any[] = [];
  for (const p of products) {
    for (const f of (await listFactories(p.id)).map(normF)) {
      for (const pe of (f as any).people || []) {
        out.push({
          name: pe.name, role: pe.role || "", wechat: pe.wechat || "",
          whatsapp: pe.whatsapp || "", email: pe.email || "",
          factory: f.name, product: p.name,
        });
      }
    }
  }
  return NextResponse.json(out);
}
