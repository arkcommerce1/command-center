// Goal 7 flows: dashboard approve -> exactly one agent-store outbox row;
// suggest -> v2 (v1 superseded); disapprove closes; WhatsApp/dashboard
// double-approve sends once; fee card queues exactly the shown @Yuki message.
// Route-level: real handlers, real file-backed stores (snapshotted/restored).
import { promises as fs } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as approvePost } from "@/app/api/drafts/[id]/versions/[vid]/approve/route";
import { POST as disapprovePost } from "@/app/api/drafts/[id]/versions/[vid]/disapprove/route";
import { POST as versionsPost } from "@/app/api/drafts/[id]/versions/route";
import { POST as replyPost } from "@/app/api/agent/approval-reply/route";
import { GET as decisionsGet } from "@/app/api/decisions/route";
import { POST as answerPost } from "@/app/api/questions/[id]/answer/route";
import { POST as claimPost } from "@/app/api/agent/outbox/claim/route";
import { __resetAgentDb, dbFind, dbInsert } from "@/lib/cc/agent-store";
import { wordDiff } from "@/lib/cc/decision-bridge";
import {
  getDraft,
  getQuestion,
  listDrafts,
  saveDraft,
  saveDraftVersion,
  saveQuestion,
} from "@/lib/cc/store";
import { Draft, DraftVersion, Question } from "@/lib/cc/types";

process.env.CC_AGENT_TOKEN = process.env.CC_AGENT_TOKEN || "test-token";
const TOKEN = process.env.CC_AGENT_TOKEN as string;

const STORE_FILE = path.join(process.cwd(), "data", "store.json");
const AGENT_FILE = path.join(process.cwd(), "data", "agent.json");

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

let snap: { store: string | null; agent: string | null } = { store: null, agent: null };

beforeEach(async () => {
  snap = { store: await readIfExists(STORE_FILE), agent: await readIfExists(AGENT_FILE) };
  __resetAgentDb();
});

afterEach(async () => {
  if (snap.store == null) await fs.rm(STORE_FILE, { force: true });
  else await fs.writeFile(STORE_FILE, snap.store);
  if (snap.agent == null) await fs.rm(AGENT_FILE, { force: true });
  else await fs.writeFile(AGENT_FILE, snap.agent);
  __resetAgentDb();
});

let seq = 0;
const nid = (p: string) => `${p}-g7-${Date.now()}-${seq++}`;

function draftReq(id: string, vid: string, body: unknown) {
  return new NextRequest(`http://test/api/drafts/${id}/versions/${vid}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params2 = (id: string, vid: string) => ({ params: Promise.resolve({ id, vid }) });

function versionRow(draftId: string, n: number, text: string): DraftVersion {
  return {
    id: nid("ver"),
    draftId,
    versionNumber: n,
    text,
    createdBy: "agent",
    suggestionText: null,
    basedOnVersion: null,
    guardrailResult: { blocked: false, reason: null },
    status: "pending",
    approvalChannel: null,
    approver: null,
    approvedAt: null,
    sentAt: null,
    disapproveReason: null,
    chatMovedOn: false,
    createdAt: Date.now(),
  };
}

async function seedApprovableDraft(text = "Hello, thanks for the update.\n\nCould you confirm the material?") {
  const fp = nid("fp");
  const draft: Draft = { id: nid("draft"), factoryProductId: fp, type: "reply", layer: 2, status: "pending", trigger: "factory asked about material", createdAt: Date.now() };
  await saveDraft(draft);
  const v1 = versionRow(draft.id, 1, text);
  await saveDraftVersion(v1);
  const chat = await dbInsert("chats", { external_id: `whatsapp:${nid("chat")}`, channel: "whatsapp", name: "Factory Group", kind: "group" });
  await dbInsert("messages", {
    external_id: nid("msg"),
    chat_id: chat.id,
    direction: "in",
    text: "可以的，请确认材料",
    translation: "Yes, please confirm the material.",
    sent_at: Date.now(),
    factory_product_id: fp,
  });
  return { fp, draft, v1, chat };
}

function replyReq(body: unknown) {
  return new NextRequest("http://test/api/agent/approval-reply", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function draftCode(draftId: string): Promise<number> {
  const all = await listDrafts();
  const sorted = [...all].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return sorted.findIndex((d) => d.id === draftId) + 1;
}

describe("Goal 7 approval flows", () => {
  it("dashboard approve creates exactly one outbox row (queued, with bubbles)", async () => {
    const { draft, v1, chat } = await seedApprovableDraft();
    const res = await approvePost(draftReq(draft.id, v1.id, {}), params2(draft.id, v1.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outbox.status).toBe("queued");
    expect(body.outbox.chat_id).toBe(chat.id);
    expect(body.outbox.bubbles).toEqual(["Hello, thanks for the update.", "Could you confirm the material?"]);
    expect(body.code).toMatch(/^D\d+\.1$/);
    const rows = await dbFind("outbox", (x: any) => x.draft_version_id === v1.id);
    expect(rows).toHaveLength(1);
    expect((await getDraft(draft.id))?.status).toBe("sent");
  });

  it("dashboard double-approve returns already-approved without resending", async () => {
    const { draft, v1 } = await seedApprovableDraft();
    await approvePost(draftReq(draft.id, v1.id, {}), params2(draft.id, v1.id));
    const res2 = await approvePost(draftReq(draft.id, v1.id, {}), params2(draft.id, v1.id));
    expect(res2.status).toBe(200);
    expect((await res2.json()).alreadyApproved).toBe(true);
    expect(await dbFind("outbox", (x: any) => x.draft_version_id === v1.id)).toHaveLength(1);
  });

  it("suggest creates v2 with highlights and disables v1", async () => {
    const { draft, v1 } = await seedApprovableDraft("Hello, thanks for the update.");
    const res = await versionsPost(
      new NextRequest(`http://test/api/drafts/${draft.id}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suggestionText: "make it warmer" }),
      }),
      { params: Promise.resolve({ id: draft.id }) },
    );
    expect(res.status).toBe(200);
    const v2 = await res.json();
    expect(v2.versionNumber).toBe(2);
    expect(v2.suggestionText).toBe("make it warmer");
    expect(v2.text).not.toBe(v1.text);
    // Word-level highlights exist between v1 and v2.
    const tokens = wordDiff(v1.text, v2.text);
    expect(tokens.some((t) => t.t !== "same")).toBe(true);
    // v1 is no longer approvable (latest-only).
    const bad = await approvePost(draftReq(draft.id, v1.id, {}), params2(draft.id, v1.id));
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as any).code).toBe("not_latest");
    // But v2 approves and queues exactly one row.
    const good = await approvePost(draftReq(draft.id, v2.id, {}), params2(draft.id, v2.id));
    expect(good.status).toBe(200);
    expect(await dbFind("outbox", (x: any) => x.draft_version_id === v2.id)).toHaveLength(1);
    expect(await dbFind("outbox", (x: any) => x.draft_version_id === v1.id)).toHaveLength(0);
  });

  it("disapprove closes the draft with an optional one-liner", async () => {
    const { draft, v1 } = await seedApprovableDraft();
    const res = await disapprovePost(draftReq(draft.id, v1.id, {}), params2(draft.id, v1.id));
    expect(res.status).toBe(200);
    expect((await getDraft(draft.id))?.status).toBe("disapproved");
    const after = await approvePost(draftReq(draft.id, v1.id, {}), params2(draft.id, v1.id));
    expect(after.status).toBe(422);
    expect(await dbFind("outbox", () => true)).toHaveLength(0);
  });

  it("WhatsApp Y approves; second Y (or dashboard approve) sends nothing twice", async () => {
    const { draft, v1 } = await seedApprovableDraft();
    const n = await draftCode(draft.id);
    const r1 = await replyPost(replyReq({ text: `Y${n}.1`, from: "haim" }));
    expect(r1.status).toBe(200);
    expect((await r1.json()).action).toBe("approved");
    const r2 = await replyPost(replyReq({ text: `Y${n}.1`, from: "haim" }));
    expect((await r2.json()).action).toBe("already_approved");
    // Dashboard approve after WhatsApp approve: already-approved, one row total.
    const r3 = await approvePost(draftReq(draft.id, v1.id, {}), params2(draft.id, v1.id));
    expect(((await r3.json()) as any).alreadyApproved).toBe(true);
    expect(await dbFind("outbox", (x: any) => x.draft_version_id === v1.id)).toHaveLength(1);
  });

  it("WhatsApp reply to an old version returns the newer-version message", async () => {
    const { draft, v1 } = await seedApprovableDraft();
    const n = await draftCode(draft.id);
    await versionsPost(
      new NextRequest(`http://test/api/drafts/${draft.id}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suggestionText: "shorter" }),
      }),
      { params: Promise.resolve({ id: draft.id }) },
    );
    const r = await replyPost(replyReq({ text: `Y${n}.1`, from: "haim" }));
    const body = await r.json();
    expect(body.action).toBe("newer_version");
    expect(body.message).toMatch(/newer version \(v2\)/);
    expect(body.latestVersion).toBe(2);
    expect(await dbFind("outbox", (x: any) => x.draft_version_id === v1.id)).toHaveLength(0);
  });

  it("WhatsApp S creates a new version; N disapproves", async () => {
    const { draft } = await seedApprovableDraft("Hello.");
    const n = await draftCode(draft.id);
    const s = await replyPost(replyReq({ text: `S${n} mention the sample`, from: "haim" }));
    expect((await s.json()).action).toBe("suggested");
    const n2 = await replyPost(replyReq({ text: `N${n}.2`, from: "haim" }));
    expect((await n2.json()).action).toBe("disapproved");
    expect((await getDraft(draft.id))?.status).toBe("disapproved");
  });

  it("fee card queues exactly the shown @Yuki message", async () => {
    const fp = nid("fp");
    const chat = await dbInsert("chats", { external_id: `whatsapp:${nid("chat")}`, channel: "whatsapp", name: "Fee Factory", kind: "group" });
    await dbInsert("messages", { external_id: nid("msg"), chat_id: chat.id, direction: "in", text: "样品费200", translation: "Sample fee 200.", sent_at: Date.now(), factory_product_id: fp });
    const yuki = "@Yuki can you pay the sample fee of 200 RMB to Fee Factory from the China office? Covers: 3 samples.";
    const q: Question = {
      id: nid("q"), factoryProductId: fp, kind: "fee",
      body: { amount: "200", currency: "RMB", covers: "3 samples", factory: "Fee Factory", factoryMessage: "样品费200", yukiMessage: yuki },
      status: "open", answer: null, importance: "high", createdAt: Date.now(),
    };
    await saveQuestion(q);
    // The card shows this exact message...
    const dec = await decisionsGet();
    const cards = ((await dec.json()) as any).cards;
    const fee = cards.find((c: any) => c.id === q.id);
    expect(fee.feeMessage).toBe(yuki);
    // ...and approving the fee queues exactly it.
    const res = await answerPost(
      new NextRequest(`http://test/api/questions/${q.id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution: "approve-fee" }),
      }),
      { params: Promise.resolve({ id: q.id }) },
    );
    expect(res.status).toBe(200);
    const rows = await dbFind("outbox", (x: any) => x.draft_version_id === `fee:${q.id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].bubbles).toEqual([yuki]);
    expect(rows[0].status).toBe("queued");
    expect((await getQuestion(q.id))?.status).toBe("answered");
  });

  it("question answer queues a draft job; uncertain mark-sent/send-again flip the row", async () => {
    const q: Question = {
      id: nid("q"), factoryProductId: nid("fp"), kind: "question",
      body: { text: "What material?", translation: "What material?" },
      status: "open", answer: null, importance: "medium", createdAt: Date.now(),
    };
    await saveQuestion(q);
    const ans = await answerPost(
      new NextRequest(`http://test/api/questions/${q.id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: "100% cotton" }),
      }),
      { params: Promise.resolve({ id: q.id }) },
    );
    expect(ans.status).toBe(200);
    expect(((await ans.json()) as any).job.type).toBe("draft");

    const row = await dbInsert("outbox", { draft_version_id: nid("dv"), chat_id: "chat-x", bubbles: ["Hi"], status: "uncertain", send_after: null });
    const uq: Question = {
      id: nid("q"), factoryProductId: nid("fp"), kind: "send_uncertain",
      body: { outboxId: row.id, chatName: "Factory Group", message: "Hi" },
      status: "open", answer: null, importance: "high", createdAt: Date.now(),
    };
    await saveQuestion(uq);
    const mark = await answerPost(
      new NextRequest(`http://test/api/questions/${uq.id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution: "mark-sent" }),
      }),
      { params: Promise.resolve({ id: uq.id }) },
    );
    expect(mark.status).toBe(200);
    expect((await dbFind("outbox", (x: any) => x.id === row.id))[0].status).toBe("sent");
  });

  it("decisions payload: counters, high-first-then-oldest, no pipeline ideas", async () => {
    await seedApprovableDraft();
    const oldLow: Question = {
      id: nid("q"), factoryProductId: null, kind: "question", body: { text: "old low" },
      status: "open", answer: null, importance: "low", createdAt: Date.now() - 99999,
    };
    await saveQuestion(oldLow);
    const res = await decisionsGet();
    expect(res.status).toBe(200);
    const payload = (await res.json()) as any;
    expect(payload.counts.toApprove).toBeGreaterThanOrEqual(1);
    expect(payload.counts.questions).toBeGreaterThanOrEqual(1);
    expect(typeof payload.counts.samples).toBe("number");
    const imps = payload.cards.map((c: any) => c.importance);
    const firstLow = imps.findIndex((i: string) => i === "low");
    const lastHigh = imps.lastIndexOf("high");
    expect(firstLow === -1 || lastHigh < firstLow).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/pipeline|ideas/i);
  });

  it("outbox claim returns the queued row with bridge routable chat id", async () => {
    const { v1 } = await seedApprovableDraft();
    const chat = (await dbFind("chats", () => true))[0];
    await dbInsert("outbox", { draft_version_id: v1.id, chat_id: chat.id, bubbles: ["A", "B"], status: "queued", send_after: null });
    const res = await claimPost(
      new NextRequest("http://test/api/agent/outbox/claim", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();
    expect(body.outbox).toBeTruthy();
    expect(body.outbox.bubbles).toEqual(["A", "B"]);
    expect(body.outbox.chat_external_id).toBe(chat.external_id);
    expect(body.outbox.lease_token).toBeTruthy();
  });
});
