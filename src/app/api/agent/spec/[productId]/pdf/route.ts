import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { agentAuth } from "@/lib/cc/agent-auth";

export const dynamic = "force-dynamic";

// GET /api/agent/spec/:productId/pdf — serve the existing generated PDF, or 501 if not ready.
export async function GET(req: NextRequest, ctx: { params: Promise<{ productId: string }> }) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const { productId } = await ctx.params;
  const candidates = [
    path.join(process.cwd(), "data", `spec-${productId}.pdf`),
    path.join(process.cwd(), "public", `spec-${productId}.pdf`),
  ];
  for (const f of candidates) {
    try {
      const buf = await fs.readFile(f);
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="spec-${productId}.pdf"` },
      });
    } catch {
      // try next candidate
    }
  }
  return NextResponse.json(
    { error: "pdf_not_ready", message: `No generated spec PDF exists yet for product ${productId}. Generate it from the dashboard first.` },
    { status: 501 },
  );
}
