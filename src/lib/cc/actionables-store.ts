// Unified layer over the two places a draft/question can live: the agent
// store (agent_kv — where Donna's Hermes plugin creates almost every real
// draft/question via POST /api/agent/drafts and the organizer) and the
// dashboard store (store.ts — legacy/manually-created rows).
//
// Root cause fixed here (see docs/STACK.md "Session Start Audit"): the old
// approve/suggest/disapprove routes only ever read/wrote the dashboard
// store, so every real, plugin-created draft 404'd the moment Haim clicked
// Approve — the Actionables buttons never actually worked against real
// WhatsApp data. Everything below resolves a draft/question by id in
// EITHER store and writes back to whichever one it actually came from.
import { dbById, dbFind, dbInsert, dbUpdate } from "@/lib/cc/agent-store";
import {
  buildOutboxRow,
  checkApprovable,
  hashBubbles,
  resolveFeeMessage,
  type SendAfterChoice,
  sendAfterFor,
  textToBubbles,
} from "@/lib/cc/decision-bridge";
import { checkGuardrail } from "@/lib/cc/guardrail";
import { freshReply, rewriteReply } from "@/lib/cc/reply-ai";
import {
  getDraft as getDashDraft,
  getQuestion as getDashQuestion,
  getDraftVersion as getDashVersion,
  getProduct,
  listDraftVersions as listDashVersions,
  listFactories,
  listProducts,
  saveDraft as saveDashDraft,
  saveQuestion as saveDashQuestion,
  saveDraftVersion as saveDashVersion,
  saveFactory,
} from "@/lib/cc/store";
import { type ApprovalChannel, type DraftVersion, type Factory, uid } from "@/lib/cc/types";

export type StoreSource = "agent" | "dashboard";

export interface UDraft {
  source: StoreSource;
  id: string;
  factoryProductId: string;
  chatId: string | null;
  status: string;
  createdAt: number;
}

export interface UVersion {
  source: StoreSource;
  id: string;
  draftId: string;
  versionNumber: number;
  bubbles: string[];
  text: string;
  status: string;
  createdAt: number;
}

export interface UQuestion {
  source: StoreSource;
  id: string;
  kind: string;
  factoryProductId: string | null;
  body: any;
  status: string;
  answer: unknown;
  importance: string;
  createdAt: number;
}

// --- reads ---

export async function getUDraft(id: string): Promise<UDraft | null> {
  const a = await dbById("drafts", id);
  if (a) {
    return {
      source: "agent",
      id: a.id,
      factoryProductId: a.factory_product_id,
      chatId: a.chat_id ?? null,
      status: a.status || "pending",
      createdAt: a.createdAt || 0,
    };
  }
  const d = await getDashDraft(id);
  if (d) {
    return {
      source: "dashboard",
      id: d.id,
      factoryProductId: d.factoryProductId,
      chatId: null,
      status: d.status,
      createdAt: d.createdAt,
    };
  }
  return null;
}

export async function listUVersions(draftId: string, source: StoreSource): Promise<UVersion[]> {
  if (source === "agent") {
    const rows = await dbFind("draftVersions", (v: any) => v.draft_id === draftId);
    return rows
      .map((v: any) => ({
        source: "agent" as const,
        id: v.id,
        draftId: v.draft_id,
        versionNumber: v.version || 1,
        bubbles: v.bubbles || [],
        text: (v.bubbles || []).join("\n\n"),
        status: v.status || "pending",
        createdAt: v.createdAt || 0,
      }))
      .sort((x, y) => x.versionNumber - y.versionNumber);
  }
  const rows = await listDashVersions(draftId);
  return rows
    .map((v) => ({
      source: "dashboard" as const,
      id: v.id,
      draftId: v.draftId,
      versionNumber: v.versionNumber,
      bubbles: textToBubbles(v.text),
      text: v.text,
      status: v.status,
      createdAt: v.createdAt,
    }))
    .sort((x, y) => x.versionNumber - y.versionNumber);
}

export async function getUQuestion(id: string): Promise<UQuestion | null> {
  const a = await dbById("questions", id);
  if (a) {
    return {
      source: "agent",
      id: a.id,
      kind: a.kind,
      factoryProductId: a.factory_product_id ?? null,
      body: a.body ?? {},
      status: a.status || "open",
      answer: a.answer ?? null,
      importance: a.importance || "medium",
      createdAt: a.createdAt || 0,
    };
  }
  const q = await getDashQuestion(id);
  if (q) {
    return {
      source: "dashboard",
      id: q.id,
      kind: q.kind,
      factoryProductId: q.factoryProductId,
      body: q.body ?? {},
      status: q.status,
      answer: q.answer,
      importance: q.importance,
      createdAt: q.createdAt,
    };
  }
  return null;
}

/** Resolve the agent-store chat for a factory_product_id via annotated messages. */
export async function resolveChatId(factoryProductId: string): Promise<string | null> {
  const msgs = await dbFind("messages", (m: any) => m.factory_product_id === factoryProductId && m.chat_id);
  if (msgs.length === 0) return null;
  msgs.sort((a: any, b: any) => (Number(b.sent_at) || 0) - (Number(a.sent_at) || 0));
  return msgs[0].chat_id as string;
}

export async function lastInboundMessage(
  factoryProductId: string | null,
  chatId: string | null,
): Promise<{ text: string; translation: string | null } | null> {
  const msgs = await dbFind("messages", (m: any) => {
    if (m.direction !== "in") return false;
    const matchesFp = Boolean(factoryProductId) && m.factory_product_id === factoryProductId;
    const matchesChat = Boolean(chatId) && m.chat_id === chatId;
    return matchesFp || matchesChat;
  });
  if (msgs.length === 0) return null;
  msgs.sort((a: any, b: any) => (Number(b.sent_at) || 0) - (Number(a.sent_at) || 0));
  const m = msgs[0];
  return { text: m.text || "", translation: m.translation || null };
}

// --- writes (store-agnostic) ---

async function setDraftStatus(d: UDraft, status: string) {
  if (d.source === "agent") {
    await dbUpdate("drafts", d.id, { status });
  } else {
    const full = await getDashDraft(d.id);
    if (full) {
      full.status = status as any;
      await saveDashDraft(full);
    }
  }
}

async function setVersionStatus(v: UVersion, patch: Record<string, any>) {
  if (v.source === "agent") {
    await dbUpdate("draftVersions", v.id, patch);
  } else {
    const full = await getDashVersion(v.id);
    if (full) {
      Object.assign(full, patch);
      await saveDashVersion(full);
    }
  }
}

async function addVersion(
  draft: UDraft,
  bubbles: string[],
  createdBy: string,
  suggestionText: string | null,
): Promise<UVersion> {
  const existing = await listUVersions(draft.id, draft.source);
  const nextVersionNumber = existing.reduce((m, v) => Math.max(m, v.versionNumber), 0) + 1;
  const text = bubbles.join("\n\n");
  if (draft.source === "agent") {
    const row = await dbInsert("draftVersions", {
      draft_id: draft.id,
      version: nextVersionNumber,
      bubbles,
      content_hash: hashBubbles(bubbles),
      source: createdBy,
      status: "pending",
      guardrail: { blocked: false, reason: null },
    });
    await dbUpdate("drafts", draft.id, { current_version: nextVersionNumber, status: "pending" });
    return {
      source: "agent",
      id: row.id,
      draftId: draft.id,
      versionNumber: row.version,
      bubbles,
      text,
      status: "pending",
      createdAt: row.createdAt,
    };
  }
  const v: DraftVersion = {
    id: uid(),
    draftId: draft.id,
    versionNumber: nextVersionNumber,
    text,
    createdBy: createdBy === "haim" ? "haim" : "ai_suggestion",
    suggestionText,
    basedOnVersion: existing.length ? existing[existing.length - 1].versionNumber : null,
    guardrailResult: checkGuardrail(text),
    status: "pending",
    approvalChannel: null,
    approver: null,
    approvedAt: null,
    sentAt: null,
    disapproveReason: null,
    chatMovedOn: false,
    createdAt: Date.now(),
  };
  await saveDashVersion(v);
  const fullDraft = await getDashDraft(draft.id);
  if (fullDraft) {
    fullDraft.status = "pending";
    await saveDashDraft(fullDraft);
  }
  return {
    source: "dashboard",
    id: v.id,
    draftId: v.draftId,
    versionNumber: v.versionNumber,
    bubbles: textToBubbles(v.text),
    text: v.text,
    status: v.status,
    createdAt: v.createdAt,
  };
}

// --- actions ---

export type ActionResult = { ok: true; message?: string } | { ok: false; httpStatus: number; message: string };

/** Approve: send the latest pending version. */
export async function approveUDraft(
  draftId: string,
  opts: { channel: ApprovalChannel; approver: string; sendAfter?: SendAfterChoice | number | null },
): Promise<ActionResult> {
  const draft = await getUDraft(draftId);
  if (!draft) return { ok: false, httpStatus: 404, message: "Card not found." };
  const versions = await listUVersions(draft.id, draft.source);
  if (versions.length === 0) return { ok: false, httpStatus: 404, message: "No draft to send." };
  const latestNumber = versions.reduce((m, v) => Math.max(m, v.versionNumber), 0);
  const version = versions.find((v) => v.versionNumber === latestNumber)!;

  const existingOutbox = await dbFind("outbox", (x: any) => x.draft_version_id === version.id);
  if (draft.status !== "pending" && existingOutbox.length > 0) return { ok: true, message: "Already sent." };

  const check = checkApprovable({
    draft: { id: draft.id, factoryProductId: draft.factoryProductId, status: draft.status },
    version: { id: version.id, draftId: version.draftId, versionNumber: version.versionNumber, text: version.text },
    latestVersionNumber: latestNumber,
    existingOutboxForVersion: existingOutbox.length,
  });
  if (!check.ok) {
    const httpStatus = check.code === "not_latest" || check.code === "already_queued" ? 409 : 422;
    return { ok: false, httpStatus, message: check.message };
  }

  const chatId = draft.chatId ?? (await resolveChatId(draft.factoryProductId));
  if (!chatId) return { ok: false, httpStatus: 409, message: "No chat found for this conversation yet — can't send." };

  if (existingOutbox.length === 0) {
    await dbInsert(
      "outbox",
      buildOutboxRow({
        versionId: version.id,
        chatId,
        bubbles: check.bubbles,
        sendAfter: sendAfterFor(opts.sendAfter ?? null, Date.now()),
      }),
    );
  }
  await setVersionStatus(version, {
    status: "approved",
    approvalChannel: opts.channel,
    approver: opts.approver,
    approvedAt: Date.now(),
    sentAt: Date.now(),
  });
  for (const other of versions) {
    if (other.id !== version.id && other.status === "pending") await setVersionStatus(other, { status: "replaced" });
  }
  await setDraftStatus(draft, "sent");
  return { ok: true };
}

/** Suggest changes: AI-rewrite the latest version to apply Haim's instruction, save as a new version. */
export async function suggestChangesOnDraft(draftId: string, instruction: string): Promise<ActionResult> {
  const draft = await getUDraft(draftId);
  if (!draft) return { ok: false, httpStatus: 404, message: "Card not found." };
  if (draft.status !== "pending") return { ok: false, httpStatus: 422, message: `This is already ${draft.status}.` };
  const versions = await listUVersions(draft.id, draft.source);
  const latest = versions[versions.length - 1] ?? null;
  const newBubbles = await rewriteReply(latest?.bubbles || [], instruction);
  const text = newBubbles.join("\n\n");
  const guardrail = checkGuardrail(text);
  if (guardrail.blocked) return { ok: false, httpStatus: 422, message: `Can't use that wording: ${guardrail.reason}` };
  for (const v of versions) if (v.status === "pending") await setVersionStatus(v, { status: "replaced" });
  await addVersion(draft, newBubbles, "haim", instruction.slice(0, 2000));
  return { ok: true };
}

/** Disapprove: close this version and have Donna write a brand-new draft from scratch. */
export async function disapproveUDraft(draftId: string, reason: string | null): Promise<ActionResult> {
  const draft = await getUDraft(draftId);
  if (!draft) return { ok: false, httpStatus: 404, message: "Card not found." };
  if (draft.status !== "pending") return { ok: false, httpStatus: 422, message: `This is already ${draft.status}.` };
  const versions = await listUVersions(draft.id, draft.source);
  const latest = versions[versions.length - 1] ?? null;
  if (latest) await setVersionStatus(latest, { status: "disapproved", disapproveReason: reason });

  const last = await lastInboundMessage(draft.factoryProductId, draft.chatId);
  const fresh = await freshReply({ lastMessageText: last?.text ?? "", reason });
  const text = fresh.join("\n\n");
  const guardrail = checkGuardrail(text);
  if (guardrail.blocked || fresh.length === 0) {
    await setDraftStatus(draft, "disapproved");
    return { ok: true, message: "Closed — Donna couldn't write a safe redraft automatically." };
  }
  await addVersion(draft, fresh, "agent", null);
  return { ok: true };
}

/** Ignore: no reply needed, card closes. */
export async function ignoreUDraft(draftId: string): Promise<ActionResult> {
  const draft = await getUDraft(draftId);
  if (!draft) return { ok: false, httpStatus: 404, message: "Card not found." };
  if (draft.status !== "pending") return { ok: false, httpStatus: 422, message: `This is already ${draft.status}.` };
  await setDraftStatus(draft, "ignored");
  return { ok: true };
}

// --- question-backed cards (fee / guardrail_block / send_uncertain / plain question) ---

async function setQuestionState(q: UQuestion, status: string, answer: unknown) {
  if (q.source === "agent") {
    await dbUpdate("questions", q.id, { status, answer });
  } else {
    const full = await getDashQuestion(q.id);
    if (full) {
      full.status = status as any;
      full.answer = answer as any;
      await saveDashQuestion(full);
    }
  }
}

export async function approveUQuestion(id: string): Promise<ActionResult> {
  const q = await getUQuestion(id);
  if (!q) return { ok: false, httpStatus: 404, message: "Card not found." };
  if (q.status !== "open") return { ok: false, httpStatus: 422, message: `Already ${q.status}.` };
  if (q.kind === "fee") {
    if (!q.factoryProductId)
      return { ok: false, httpStatus: 409, message: "No conversation linked to this fee question." };
    const chatId = await resolveChatId(q.factoryProductId);
    if (!chatId) return { ok: false, httpStatus: 409, message: "No chat found; can't send." };
    const message = resolveFeeMessage(q.body || {});
    const existing = await dbFind("outbox", (x: any) => x.draft_version_id === `fee:${q.id}`);
    if (existing.length === 0) {
      await dbInsert("outbox", {
        draft_version_id: `fee:${q.id}`,
        chat_id: chatId,
        bubbles: [message],
        status: "queued",
        send_after: null,
      });
    }
    await setQuestionState(q, "answered", { resolution: "approved", message });
    return { ok: true };
  }
  if (q.kind === "send_uncertain") {
    const outboxId = typeof q.body?.outboxId === "string" ? q.body.outboxId : null;
    if (outboxId)
      await dbUpdate("outbox", outboxId, {
        status: "sent",
        lease_token: null,
        lease_expires_at: null,
        finishedAt: Date.now(),
      });
    await setQuestionState(q, "answered", { resolution: "mark-sent" });
    return { ok: true };
  }
  return {
    ok: false,
    httpStatus: 422,
    message: "Nothing to send yet — use Suggest changes to tell Donna what to say.",
  };
}

export async function suggestChangesOnQuestion(id: string, instruction: string): Promise<ActionResult> {
  const q = await getUQuestion(id);
  if (!q) return { ok: false, httpStatus: 404, message: "Card not found." };
  if (q.status !== "open") return { ok: false, httpStatus: 422, message: `Already ${q.status}.` };
  if (q.kind === "fee") {
    // Stays open — "suggest changes" here is a note for Haim's own future
    // reference, not a resolution, so the same card keeps waiting on him.
    if (q.source === "agent") {
      await dbUpdate("questions", q.id, { body: { ...(q.body ?? {}), note: instruction.slice(0, 2000) } });
    } else {
      const full = await getDashQuestion(q.id);
      if (full) {
        full.body = { ...((full.body as object) ?? {}), note: instruction.slice(0, 2000) } as unknown;
        await saveDashQuestion(full);
      }
    }
    return { ok: true };
  }
  // question / guardrail_block: Haim's instruction becomes a fresh drafted reply.
  const bubbles = await rewriteReply([], instruction);
  const text = bubbles.join("\n\n");
  const guardrail = checkGuardrail(text);
  if (guardrail.blocked) return { ok: false, httpStatus: 422, message: `Can't use that wording: ${guardrail.reason}` };
  if (!q.factoryProductId)
    return { ok: false, httpStatus: 409, message: "No conversation linked; can't draft a reply." };
  const chatId = await resolveChatId(q.factoryProductId);
  const draftRow = await dbInsert("drafts", {
    factory_product_id: q.factoryProductId,
    chat_id: chatId ?? "",
    kind: "reply",
    reason: "haim-guidance",
    status: "pending",
  });
  await dbInsert("draftVersions", {
    draft_id: draftRow.id,
    version: 1,
    bubbles,
    content_hash: hashBubbles(bubbles),
    source: "haim",
    status: "pending",
    guardrail: { blocked: false, reason: null },
  });
  await setQuestionState(q, "answered", instruction.slice(0, 2000));
  return { ok: true };
}

export async function disapproveUQuestion(id: string): Promise<ActionResult> {
  const q = await getUQuestion(id);
  if (!q) return { ok: false, httpStatus: 404, message: "Card not found." };
  if (q.status !== "open") return { ok: false, httpStatus: 422, message: `Already ${q.status}.` };
  if (q.kind === "fee") {
    await setQuestionState(q, "answered", { resolution: "declined" });
    return { ok: true };
  }
  if (q.kind === "send_uncertain") {
    const outboxId = typeof q.body?.outboxId === "string" ? q.body.outboxId : null;
    if (outboxId)
      await dbUpdate("outbox", outboxId, { status: "queued", lease_token: null, lease_expires_at: null, error: null });
    await setQuestionState(q, "answered", { resolution: "send-again" });
    return { ok: true };
  }
  return { ok: false, httpStatus: 422, message: "Use Suggest changes to tell Donna what to say instead." };
}

export async function ignoreUQuestion(id: string): Promise<ActionResult> {
  const q = await getUQuestion(id);
  if (!q) return { ok: false, httpStatus: 404, message: "Card not found." };
  if (q.status !== "open") return { ok: false, httpStatus: 422, message: `Already ${q.status}.` };
  await setQuestionState(q, "ignored", null);
  return { ok: true };
}

// --- product linking (the "which product?" dropdown) ---

export async function findFactoryByConversation(
  conversationKey: string,
): Promise<{ factory: Factory; productId: string } | null> {
  const products = await listProducts();
  for (const p of products) {
    const factories = await listFactories(p.id);
    const f = factories.find((x) => x.agentFactoryProductId === conversationKey);
    if (f) return { factory: f, productId: p.id };
  }
  return null;
}

export async function linkConversationToProduct(
  conversationKey: string,
  productId: string,
  factoryName: string,
): Promise<Factory> {
  const existing = await findFactoryByConversation(conversationKey);
  if (existing) return existing.factory;
  const product = await getProduct(productId);
  if (!product) throw new Error("product not found");
  const f: Factory = {
    id: uid(),
    productId,
    name: factoryName || "New factory contact",
    contact: "",
    channel: "WhatsApp",
    active: true,
    fstage: "intro",
    factoryStage: "spec_agreed",
    sampleStatus: "none",
    quoteStatus: "none",
    people: [],
    lastContactAt: Date.now(),
    sampleRequestedAt: null,
    sampleShippedAt: null,
    reminders: [],
    comments: [],
    files: [],
    quotes: [],
    updatedAt: Date.now(),
    agentFactoryProductId: conversationKey,
  };
  await saveFactory(f);
  const pending = await dbFind(
    "questions",
    (q: any) => q.kind === "product_pick" && q.status === "open" && q.factory_product_id === conversationKey,
  );
  for (const q of pending) await dbUpdate("questions", q.id, { status: "answered", answer: { productId } });
  return f;
}
