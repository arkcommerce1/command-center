import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listFactories, listProducts } from "@/lib/cc/store";
import { computeActionables } from "@/lib/cc/engine";
import { esc, sendEmail } from "@/lib/cc/email";

// GET /api/digest — called by Vercel Cron every morning at 8am.
export async function GET(req: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const products = await listProducts();
  const allf = (await Promise.all(products.map((p) => listFactories(p.id)))).flat();
  const items = computeActionables(products, allf);
  const active = products.filter((p) => p.started && p.stage !== "dead" && p.stage !== "live").length;
  const html = `<h2>Today's actionables (${items.length})</h2><p>${active} active product(s).</p>` +
    (items.length ? "<ul>" + items.map((a) => `<li><b>${esc(a.productName)}</b> — ${esc(a.text)}</li>`).join("") + "</ul>"
      : "<p>Nothing needs you. Pipeline is moving.</p>");
  await sendEmail(`Command Center digest: ${items.length} actionable(s)`, html);
  return NextResponse.json({ sent: items.length });
}
