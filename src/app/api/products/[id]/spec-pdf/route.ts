import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getProduct } from "@/lib/cc/store";
import { generateSpecPdf } from "@/lib/cc/spec-pdf-generator";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProduct(id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const includeQty = url.searchParams.get("qty") === "1";
  // Download route: always include order qty unless ?qty=0 is explicitly passed
  const bytes = await generateSpecPdf(p, { includeOrderQty: includeQty || !url.searchParams.has("qty") });
  const masterSku = (p as any).masterSku || p.name || "spec";
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${String(masterSku).replace(/[^a-z0-9-_]+/gi, "_")}_spec.pdf"`,
    },
  });
}
