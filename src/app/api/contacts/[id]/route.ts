import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { deleteContact } from "@/lib/cc/store";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteContact(id);
  return NextResponse.json({ ok: true });
}
