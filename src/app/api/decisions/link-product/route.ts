import { type NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { linkConversationToProduct } from "@/lib/cc/actionables-store";

// POST /api/decisions/link-product — the "which product?" dropdown on an
// Actionables card whose chat isn't linked to a product yet.
// Body: { conversationKey, productId, factoryName? }
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}) as any);
  const conversationKey = typeof b?.conversationKey === "string" ? b.conversationKey : "";
  const productId = typeof b?.productId === "string" ? b.productId : "";
  if (!conversationKey || !productId) {
    return NextResponse.json({ error: "conversationKey and productId required" }, { status: 400 });
  }
  try {
    const factory = await linkConversationToProduct(
      conversationKey,
      productId,
      String(b?.factoryName || "").slice(0, 200),
    );
    return NextResponse.json({ factory });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "link failed" }, { status: 400 });
  }
}
