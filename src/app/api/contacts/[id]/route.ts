import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getContact, listFactories, listProducts, saveContact } from "@/lib/cc/store";
import { dbById, dbUpdate } from "@/lib/cc/agent-store";
import { normF, normP } from "@/lib/cc/types";

// Parse "kind:value, kind:value" (e.g. "whatsapp:+123, email:a@b.c").
export function parseChannelsText(t: string): { kind: string; value: string }[] {
  return String(t || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf(":");
      if (i < 0) return null;
      const kind = p.slice(0, i).trim().toLowerCase();
      const value = p.slice(i + 1).trim();
      if (!kind || !value) return null;
      if (!["whatsapp", "wechat", "email"].includes(kind)) return null;
      return { kind, value: value.slice(0, 120) };
    })
    .filter((x): x is { kind: string; value: string } => !!x);
}

async function resolveFactoryId(company: string): Promise<string | null> {
  const want = String(company || "").trim().toLowerCase();
  if (!want) return null;
  const products = (await listProducts()).map(normP);
  for (const p of products) {
    for (const f of (await listFactories(p.id)).map(normF)) {
      if (f.name.trim().toLowerCase() === want) return f.id;
    }
  }
  return null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json();

  // 1) Dashboard standalone contact. Haim's edits are stamped created_by haim
  // so the contacts agent never overwrites them (SPEC Goal 3).
  const c = await getContact(id);
  if (c) {
    if (b.name !== undefined) c.name = String(b.name).slice(0, 120);
    if (b.role !== undefined) c.role = String(b.role).slice(0, 80);
    if (b.company !== undefined) c.company = String(b.company).slice(0, 120);
    if (b.wechat !== undefined) c.wechat = String(b.wechat).slice(0, 80);
    if (b.whatsapp !== undefined) c.whatsapp = String(b.whatsapp).slice(0, 40);
    if (b.email !== undefined) c.email = String(b.email).slice(0, 120);
    if (b.notes !== undefined) c.notes = String(b.notes).slice(0, 500);
    if (b.description !== undefined) c.notes = String(b.description).slice(0, 500);
    if (b.kind !== undefined && (b.kind === "ours" || b.kind === "factory")) (c as any).type = b.kind;
    if (b.channelsText !== undefined) {
      for (const ch of parseChannelsText(b.channelsText)) {
        if (ch.kind === "whatsapp") c.whatsapp = ch.value.slice(0, 40);
        else if (ch.kind === "wechat") c.wechat = ch.value.slice(0, 80);
        else if (ch.kind === "email") c.email = ch.value.slice(0, 120);
      }
    }
    (c as any).created_by = "haim";
    await saveContact(c);
    return NextResponse.json(c);
  }

  // 2) Agent-store contact (cc-contacts skill rows): same PATCH surface so
  // every cell on the Contacts page saves inline. Haim's edit stamps
  // created_by haim.
  const a = await dbById("contacts", id);
  if (a) {
    const patch: Record<string, any> = { created_by: "haim" };
    if (b.name !== undefined) patch.name = String(b.name).slice(0, 120);
    if (b.role !== undefined) patch.role = String(b.role).slice(0, 80);
    if (b.role_note !== undefined) patch.role_note = String(b.role_note).slice(0, 200);
    if (b.description !== undefined) patch.description = String(b.description).slice(0, 500);
    if (b.notes !== undefined) patch.description = String(b.notes).slice(0, 500);
    if (b.kind !== undefined && (b.kind === "ours" || b.kind === "factory")) patch.type = b.kind;
    if (b.company !== undefined) {
      const company = String(b.company).slice(0, 120);
      patch.company = company;
      const fid = await resolveFactoryId(company);
      if (fid) patch.factory_id = fid;
      else if (company.trim() === "") patch.factory_id = "";
    }
    if (b.channelsText !== undefined) patch.channels = parseChannelsText(b.channelsText);
    const updated = await dbUpdate("contacts", id, patch);
    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { deleteContact } = await import("@/lib/cc/store");
  await deleteContact(id);
  return NextResponse.json({ ok: true });
}
