import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listFactories, listProducts } from "@/lib/cc/store";
import { computeActionables } from "@/lib/cc/engine";

export async function GET() {
  const products = await listProducts();
  const allf = (await Promise.all(products.map((p) => listFactories(p.id)))).flat();
  return NextResponse.json(computeActionables(products, allf));
}
