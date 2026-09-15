import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listFactories, saveFactory } from "@/lib/cc/store";
import { Factory, normF, uid } from "@/lib/cc/types";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json((await listFactories(id)).map(normF));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const f: Factory = {
    id: uid(), productId: id, name: String(body.name || "New factory"),
    contact: String(body.contact || ""), channel: String(body.channel || "WeChat"),
    active: true, fstage: "intro", sampleStatus: "none", quoteStatus: "none",
    lastContactAt: null, sampleRequestedAt: null, sampleShippedAt: null,
    reminders: [], comments: [], files: [], quotes: [], updatedAt: Date.now(),
  };
  await saveFactory(f);
  return NextResponse.json(f);
}
