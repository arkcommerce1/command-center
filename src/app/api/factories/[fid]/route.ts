import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { deleteFactory, getFactory, saveFactory } from "@/lib/cc/store";
import { esc, sendEmail } from "@/lib/cc/email";
import { normF } from "@/lib/cc/types";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const f = await getFactory(fid);
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(normF(f));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const f = await getFactory(fid);
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
  const b = await req.json();
  const prevSample = f.sampleStatus, prevQuote = f.quoteStatus, prevF = (f as any).fstage;
  for (const k of ["name", "contact", "channel", "sampleStatus", "quoteStatus", "fstage"] as const)
    if (b[k] !== undefined) (f as any)[k] = b[k];
  if (b.active !== undefined) f.active = !!b.active;
  if (b.canShareVolumes !== undefined) (f as any).canShareVolumes = !!b.canShareVolumes;
  if (b.lastContactAt !== undefined) f.lastContactAt = b.lastContactAt;
  if (b.sampleRequestedAt !== undefined) f.sampleRequestedAt = b.sampleRequestedAt;
  if (b.sampleShippedAt !== undefined) f.sampleShippedAt = b.sampleShippedAt;
  if (b.addComment) f.comments.unshift({ ts: Date.now(), text: String(b.addComment).slice(0, 2000) });
  if (b.addReminder) f.reminders.push({ id: Math.random().toString(36).slice(2, 9), date: String(b.addReminder.date), text: String(b.addReminder.text).slice(0, 500), done: false });
  if (b.toggleReminder) { const r = f.reminders.find((x) => x.id === b.toggleReminder); if (r) r.done = !r.done; }
  if (b.addQuote) { f.quotes.push({ unitPrice: Number(b.addQuote.unitPrice) || 0, qty: Number(b.addQuote.qty) || 0, notes: String(b.addQuote.notes || ""), ts: Date.now() }); f.quoteStatus = "received"; }
  if (b.addFile) f.files.unshift({ name: String(b.addFile.name), url: String(b.addFile.url), ts: Date.now() });
  if (b.addPerson) { f.people.unshift({ id: Math.random().toString(36).slice(2, 9), name: String(b.addPerson.name || "").slice(0, 80), role: String(b.addPerson.role || "").slice(0, 80), wechat: String(b.addPerson.wechat || "").slice(0, 80), whatsapp: String(b.addPerson.whatsapp || "").slice(0, 40), email: String(b.addPerson.email || "").slice(0, 120) }); }
  if (b.delPerson) { f.people = f.people.filter((x: any) => x.id !== b.delPerson); }
  await saveFactory(f);
  if (prevSample !== f.sampleStatus || prevQuote !== f.quoteStatus || prevF !== (f as any).fstage) {
    sendEmail(`Factory update: ${esc(f.name)} — ${(f as any).fstage || ""} · sample ${esc(f.sampleStatus)}, quote ${esc(f.quoteStatus)}`,
      `<p><b>${esc(f.name)}</b>: stage ${esc(prevF || "")} → <b>${esc((f as any).fstage || "")}</b>, sample ${esc(prevSample)} → <b>${esc(f.sampleStatus)}</b>, quote ${esc(prevQuote)} → <b>${esc(f.quoteStatus)}</b>.</p>`).catch(() => {});
  }
  for (const r of f.reminders.filter((x) => !x.done && new Date(x.date).getTime() <= Date.now())) {
    sendEmail(`Reminder due: ${esc(r.text)} (${esc(f.name)})`, `<p>${esc(r.text)}</p><p>Factory: ${esc(f.name)}</p>`).catch(() => {});
    r.done = true;
  }
  await saveFactory(f);
  return NextResponse.json(f);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  await deleteFactory(fid);
  return NextResponse.json({ ok: true });
}
