import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { deleteContact, getContact, saveContact } from "@/lib/cc/store";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getContact(id);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  const b = await req.json();
  if (b.name !== undefined) c.name = String(b.name).slice(0, 120);
  if (b.role !== undefined) c.role = String(b.role).slice(0, 80);
  if (b.company !== undefined) c.company = String(b.company).slice(0, 120);
  if (b.wechat !== undefined) c.wechat = String(b.wechat).slice(0, 80);
  if (b.whatsapp !== undefined) c.whatsapp = String(b.whatsapp).slice(0, 40);
  if (b.email !== undefined) c.email = String(b.email).slice(0, 120);
  if (b.notes !== undefined) c.notes = String(b.notes).slice(0, 500);
  await saveContact(c);
  return NextResponse.json(c);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteContact(id);
  return NextResponse.json({ ok: true });
}
