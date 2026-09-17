import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentAuth, agentBody } from "@/lib/cc/agent-auth";
import { dbById, dbFind, dbInsert, dbUpdate } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

const Ingest = z.object({
  external_id: z.string().min(1),
  chat: z.object({
    external_id: z.string().min(1),
    channel: z.enum(["whatsapp", "email"]).default("whatsapp"),
    name: z.string().optional().default(""),
    kind: z.enum(["group", "dm", "email_thread"]).default("group"),
    factory_id: z.string().optional().default(""),
  }),
  members: z
    .array(z.object({ external_id: z.string().optional(), name: z.string().optional().default(""), contact_id: z.string().optional() }))
    .optional()
    .default([]),
  message: z.object({
    direction: z.enum(["in", "out"]).default("in"),
    contact_id: z.string().optional().default(""),
    text: z.string().optional().default(""),
    translation: z.string().optional().default(""),
    lang: z.string().optional().default(""),
    media: z.any().optional(),
    sent_at: z.number().optional(),
    factory_product_id: z.string().optional().default(""),
    is_ours: z.boolean().optional().default(false),
  }),
  is_ours: z.boolean().optional().default(false),
});

// POST /api/agent/ingest — idempotent on external_id; upserts chat+members; queues contacts+organize jobs.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const [raw, err] = await agentBody(req);
  if (err) return err;
  const parsed = Ingest.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;

  // Idempotency: same external_id returns the existing message.
  const existing = await dbFind("messages", (m) => m.external_id === b.external_id);
  if (existing.length > 0) return NextResponse.json({ deduped: true, message: existing[0] });

  let chat = (await dbFind("chats", (c) => c.external_id === b.chat.external_id))[0];
  if (chat) {
    chat = await dbUpdate("chats", chat.id, {
      name: b.chat.name || chat.name,
      factory_id: b.chat.factory_id || chat.factory_id,
    });
  } else {
    chat = await dbInsert("chats", { ...b.chat });
  }
  for (const m of b.members) {
    const dup = await dbFind(
      "chatMembers",
      (x) => x.chat_id === chat.id && (x.contact_id || x.external_id) === (m.contact_id || m.external_id),
    );
    if (dup.length === 0) await dbInsert("chatMembers", { chat_id: chat.id, ...m });
  }
  const message = await dbInsert("messages", {
    external_id: b.external_id,
    chat_id: chat.id,
    ...b.message,
    sent_at: b.message.sent_at || Date.now(),
  });

  // Queue jobs with RICH payloads so processors can actually work.
  const sender = b.members.find((m) => m.external_id === b.message.contact_id) || b.members[0] || {};
  const jobPayload = {
    chat: {
      id: chat.id,
      external_id: b.chat.external_id,
      channel: b.chat.channel,
      name: b.chat.name,
      kind: b.chat.kind,
      factory_id: b.chat.factory_id,
    },
    sender: {
      external_id: sender.external_id || "",
      name: sender.name || "",
      contact_id: sender.contact_id || b.message.contact_id || "",
    },
    message: {
      id: message.id,
      external_id: b.external_id,
      text: b.message.text,
      direction: b.message.direction,
      sent_at: b.message.sent_at || Date.now(),
      contact_id: b.message.contact_id || sender.external_id || "",
    },
    existing_contacts: [] as any[],
    known_factories: [] as any[],
  };

  const isOurs = !!(b as any).is_ours || !!(b.message as any).is_ours;
  if (isOurs) {
    // Messages from "our people": save but skip contact/actionable creation.
    return NextResponse.json({ deduped: false, chat, message, jobs_queued: [], is_ours: true });
  }

  const senderKnown = !!b.message.contact_id;
  if (!senderKnown) {
    await dbInsert("agentJobs", { type: "contacts", status: "queued", payload: jobPayload });
  }
  const pendingOrganize = await dbFind(
    "agentJobs",
    (j) => j.type === "organize" && j.status === "queued" && j.payload?.chat_id === chat.id,
  );
  if (pendingOrganize.length === 0) {
    await dbInsert("agentJobs", { type: "organize", status: "queued", payload: jobPayload });
  }
  return NextResponse.json({ deduped: false, chat, message, jobs_queued: senderKnown ? ["organize"] : ["contacts", "organize"] });
}

export async function GET(req: NextRequest) {
  void dbById;
  const auth = agentAuth(req);
  if (auth) return auth;
  return NextResponse.json({ usage: "POST with {external_id, chat, members, message}" });
}
