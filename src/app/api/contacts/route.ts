import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getFactory, listContacts, listFactories, listProducts, pgInit, saveContact } from "@/lib/cc/store";
import { dbFind } from "@/lib/cc/agent-store";
import { Contact, normF, normP, uid } from "@/lib/cc/types";

// GET /api/contacts — unified directory (Goal 3 store-merge decision, see
// docs/STACK.md Decisions): dashboard standalone contacts + factory-linked
// people + agent-store contacts (cc-contacts skill writes), merged server-side
// so the Agent API token never reaches the browser. Legacy fields are kept so
// existing UI reads don't break; SPEC columns ride alongside as
// kind/description/channels/groups/lastMessage.
export async function GET() {
  await pgInit();
  const standalone = (await listContacts()).map((c) => {
    const channels = toChannels({ wechat: c.wechat, whatsapp: c.whatsapp, email: c.email });
    return {
      id: c.id, name: c.name, role: c.role, company: c.company,
      wechat: c.wechat, whatsapp: c.whatsapp, email: c.email, notes: c.notes || "",
      factory: "", product: "", source: "contact" as const, store: "dashboard" as const,
      kind: ((c as any).type === "ours" ? "ours" : "factory") as "ours" | "factory",
      description: c.notes || "",
      channels, channelsText: channelsToText(channels),
      groups: [] as string[], lastMessage: null as { text: string; sent_at: number } | null,
      unmatched: false,
      created_by: (c as any).created_by || "",
    };
  });
  const products = (await listProducts()).map(normP);
  const linked: any[] = [];
  for (const p of products) {
    for (const f of (await listFactories(p.id)).map(normF)) {
      for (const pe of (f as any).people || []) {
        const channels = toChannels({ wechat: pe.wechat, whatsapp: pe.whatsapp, email: pe.email });
        linked.push({
          id: pe.id, name: pe.name, role: pe.role || "", company: f.name,
          wechat: pe.wechat || "", whatsapp: pe.whatsapp || "", email: pe.email || "", notes: "",
          factory: f.name, product: p.name, source: "factory" as const, store: "factory-person" as const,
          kind: "factory" as const,
          description: "",
          channels, channelsText: channelsToText(channels),
          groups: [] as string[], lastMessage: null as { text: string; sent_at: number } | null,
          unmatched: false,
          created_by: "",
        });
      }
    }
  }
  // Agent-store contacts: carry type, role, role_source, channels, groups.
  let agent: any[] = [];
  try {
    const rows = await dbFind("contacts", () => true);
    const members = await dbFind("chatMembers", () => true);
    const chats = await dbFind("chats", () => true);
    const messages = await dbFind("messages", () => true);
    const chatById = new Map(chats.map((c: any) => [c.id, c]));
    agent = await Promise.all(
      rows.map(async (c: any) => {
        const channels: { kind: string; value: string }[] = Array.isArray(c.channels) ? c.channels : [];
        const groups = members
          .filter((m: any) => m.contact_id === c.id)
          .map((m: any) => chatById.get(m.chat_id)?.name || chatById.get(m.chat_id)?.external_id || "")
          .filter(Boolean)
          .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
        const msgs = messages.filter((m: any) => m.contact_id === c.id);
        msgs.sort((a: any, b: any) => Number(b.sent_at || 0) - Number(a.sent_at || 0));
        const last = msgs[0];
        let company = String(c.company || "");
        if (c.factory_id && !company) {
          try {
            const f = await getFactory(String(c.factory_id));
            company = f ? f.name : String(c.factory_id);
          } catch {
            company = String(c.factory_id);
          }
        }
        const kind = c.type === "ours" ? "ours" : "factory";
        return {
          id: c.id, name: c.name || "", role: c.role || "", company,
          wechat: channelVal(channels, "wechat"), whatsapp: channelVal(channels, "whatsapp"),
          email: channelVal(channels, "email"), notes: c.description || "",
          factory: company, product: "", source: "agent-contact" as const, store: "agent" as const,
          kind, role_note: c.role_note || "", role_source: c.role_source || "default",
          description: c.description || "",
          channels, channelsText: channelsToText(channels),
          groups,
          lastMessage: last
            ? { text: String(last.translation || last.text || "").slice(0, 120), sent_at: Number(last.sent_at || 0) }
            : null,
          unmatched: kind === "factory" && !c.factory_id && !company,
          created_by: c.created_by || "agent",
        };
      }),
    );
  } catch {
    // Agent store unreadable (e.g. no data yet): dashboard rows still serve.
    agent = [];
  }
  return NextResponse.json([...standalone, ...linked, ...agent]);
}

function toChannels(p: { wechat?: string; whatsapp?: string; email?: string }) {
  const out: { kind: string; value: string }[] = [];
  if (p.whatsapp) out.push({ kind: "whatsapp", value: p.whatsapp });
  if (p.wechat) out.push({ kind: "wechat", value: p.wechat });
  if (p.email) out.push({ kind: "email", value: p.email });
  return out;
}

function channelVal(channels: { kind: string; value: string }[], kind: string) {
  return channels.find((c) => c.kind === kind)?.value || "";
}

function channelsToText(channels: { kind: string; value: string }[]) {
  return channels.map((c) => `${c.kind}:${c.value}`).join(", ");
}

// POST /api/contacts — add a standalone contact (name, role, company, wechat, whatsapp, email, notes).
export async function POST(req: NextRequest) {
  await pgInit();
  const b = await req.json();
  if (!String(b.name || "").trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  const c: Contact = {
    id: uid(), name: String(b.name).slice(0, 120), role: String(b.role || "").slice(0, 80),
    company: String(b.company || "").slice(0, 120), wechat: String(b.wechat || "").slice(0, 80),
    whatsapp: String(b.whatsapp || "").slice(0, 40), email: String(b.email || "").slice(0, 120),
    notes: String(b.notes || "").slice(0, 500), createdAt: Date.now(),
  };
  (c as any).created_by = "haim";
  if (b.kind === "ours" || b.kind === "factory") (c as any).type = b.kind;
  await saveContact(c);
  return NextResponse.json(c);
}

export function __test_only() {
  return { toChannels, channelsToText, channelVal };
}
