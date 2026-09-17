// Regression coverage for the Actionables rebuild (docs/STACK.md "Session
// Start Audit"). The real bug: every draft Donna's plugin creates lives in
// the agent store, but the old approve/suggest/disapprove routes only ever
// read/wrote the dashboard store — so clicking Approve on a real WhatsApp
// draft always 404'd. These tests exercise the unified adapter directly
// against agent-store rows (the case that was completely broken before).

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as decisionsGet } from "@/app/api/decisions/route";
import {
  approveUDraft,
  approveUQuestion,
  disapproveUDraft,
  findFactoryByConversation,
  ignoreUDraft,
  linkConversationToProduct,
  listUVersions,
  suggestChangesOnDraft,
  suggestChangesOnQuestion,
} from "@/lib/cc/actionables-store";
import { __resetAgentDb, dbById, dbFind, dbInsert } from "@/lib/cc/agent-store";
import { resolveFeeMessage } from "@/lib/cc/decision-bridge";
import { listFactories, saveProduct, saveQuestion } from "@/lib/cc/store";
import type { Product, Question } from "@/lib/cc/types";

import { promises as fs } from "node:fs";
import path from "node:path";

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
  delete process.env.NOUS_API_KEY; // force the deterministic fallback path — no network in tests
});

afterEach(async () => {
  if (snap.store == null) await fs.rm(STORE_FILE, { force: true });
  else await fs.writeFile(STORE_FILE, snap.store);
  if (snap.agent == null) await fs.rm(AGENT_FILE, { force: true });
  else await fs.writeFile(AGENT_FILE, snap.agent);
  __resetAgentDb();
});

let seq = 0;
const nid = (p: string) => `${p}-act-${Date.now()}-${seq++}`;

function blankProduct(over: Partial<Product> = {}): Product {
  return {
    id: nid("prod"),
    name: "Test Product",
    started: true,
    stage: "idea",
    stageUpdatedAt: Date.now(),
    createdAt: Date.now(),
    asin: "",
    imageUrl: "",
    fbaSheetUrl: "",
    startDate: "",
    masterSku: "",
    skus: [],
    specDone: false,
    sourcingStarted: false,
    spec: {
      skus: "",
      sizes: "",
      packSizes: "",
      materials: "",
      orderUnits: "",
      photos: "",
      notes: "",
      sheetUrl: "",
      lastUpdate: "",
    },
    costs: { sellPrice: 0, referralFeePct: 15, fbaFee: 0, dutiesPct: 0, shippingUnit: 0, ppcUnit: 0, monthlySales: 0 },
    specFields: [],
    specVersion: 0,
    specVersions: [],
    specUpdatedAt: null,
    yukiChecklist: { items: "", variants: "", quantities: "", deliveryAddress: "", fee: "", dates: "" },
    boxCutoffDate: "",
    yukiBriefs: [],
    approach: "already_selling",
    amazonSnapshot: null,
    productStatus: "active",
    estimatedMonthlySales: 0,
    averagePricePerUnit: 0,
    ...over,
  };
}

/** Seed an agent-store draft the way Donna's plugin actually creates one. */
async function seedAgentDraft(
  fp: string,
  bubbles: string[] = ["Hi, thanks for reaching out!", "What products are you looking to supply?"],
) {
  const chat = await dbInsert("chats", {
    external_id: `whatsapp:${nid("chat")}`,
    channel: "whatsapp",
    name: "Factory Group",
    kind: "group",
  });
  await dbInsert("messages", {
    external_id: nid("msg"),
    chat_id: chat.id,
    factory_product_id: fp,
    direction: "in",
    sender: "Carlos from Nanjong",
    text: "Hi we are Nanjong Industrial Company how can we help",
    translation: "",
    sent_at: Date.now(),
  });
  const draft = await dbInsert("drafts", {
    factory_product_id: fp,
    chat_id: chat.id,
    kind: "opener",
    reason: "opener",
    status: "pending",
  });
  await dbInsert("draftVersions", {
    draft_id: draft.id,
    version: 1,
    bubbles,
    content_hash: "x",
    source: "ai",
    status: "pending",
    guardrail: { blocked: false, reason: null },
  });
  return { draft, chat };
}

describe("actionables-store: agent-store drafts (the previously-broken path)", () => {
  it("approve sends the draft: outbox row created, draft marked sent", async () => {
    const fp = nid("fp");
    const { draft, chat } = await seedAgentDraft(fp);

    const result = await approveUDraft(draft.id, { channel: "dashboard", approver: "haim" });
    expect(result.ok).toBe(true);

    const outbox = await dbFind("outbox", (x: any) => x.chat_id === chat.id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].bubbles).toEqual(["Hi, thanks for reaching out!", "What products are you looking to supply?"]);
    expect(outbox[0].status).toBe("queued");

    const stored = await dbById("drafts", draft.id);
    expect(stored.status).toBe("sent");
    const versions = await listUVersions(draft.id, "agent");
    expect(versions[0].status).toBe("approved");
  });

  it("double-approve does not queue a second outbox row", async () => {
    const fp = nid("fp");
    const { draft } = await seedAgentDraft(fp);
    await approveUDraft(draft.id, { channel: "dashboard", approver: "haim" });
    const again = await approveUDraft(draft.id, { channel: "dashboard", approver: "haim" });
    expect(again.ok).toBe(true);
    const outbox = await dbFind("outbox", (x: any) => x.chat_id !== undefined);
    expect(outbox).toHaveLength(1);
  });

  it("suggest changes creates a new pending version and supersedes the old one", async () => {
    const fp = nid("fp");
    const { draft } = await seedAgentDraft(fp, ["Hi there."]);
    const result = await suggestChangesOnDraft(draft.id, "mention the sample");
    expect(result.ok).toBe(true);

    const versions = await listUVersions(draft.id, "agent");
    expect(versions).toHaveLength(2);
    const v1 = versions.find((v) => v.versionNumber === 1)!;
    const v2 = versions.find((v) => v.versionNumber === 2)!;
    expect(v1.status).toBe("replaced");
    expect(v2.status).toBe("pending");
    expect(v2.text).not.toBe(v1.text);
  });

  it("suggest changes refuses wording that trips the guardrail", async () => {
    const fp = nid("fp");
    const { draft } = await seedAgentDraft(fp, ["Hi there."]);
    const result = await suggestChangesOnDraft(draft.id, 'replace "Hi there." with "We can pay $5 per unit."');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(422);
    // No new version was written.
    const versions = await listUVersions(draft.id, "agent");
    expect(versions).toHaveLength(1);
  });

  it("disapprove closes the old version and drafts a fresh one from scratch", async () => {
    const fp = nid("fp");
    const { draft } = await seedAgentDraft(fp, ["Old wording."]);
    const result = await disapproveUDraft(draft.id, "too generic");
    expect(result.ok).toBe(true);

    const versions = await listUVersions(draft.id, "agent");
    const v1 = versions.find((v) => v.versionNumber === 1)!;
    expect(v1.status).toBe("disapproved");
    expect(v1.text).toBe("Old wording.");
    const fresh = versions.find((v) => v.versionNumber === 2);
    expect(fresh?.status).toBe("pending");
    expect(fresh?.text).not.toBe("Old wording.");

    const stored = await dbById("drafts", draft.id);
    expect(stored.status).toBe("pending"); // reopened for the fresh draft, not dead-ended
  });

  it("ignore closes the draft with no outbox row and it disappears from Actionables", async () => {
    const fp = nid("fp");
    const { draft } = await seedAgentDraft(fp);
    const result = await ignoreUDraft(draft.id);
    expect(result.ok).toBe(true);
    expect(await dbFind("outbox", () => true)).toHaveLength(0);

    const payload = (await (await decisionsGet()).json()) as any;
    expect(payload.cards.find((c: any) => c.id === `draft:${draft.id}`)).toBeUndefined();
  });

  it("cannot act twice: approving an already-sent draft is refused", async () => {
    const fp = nid("fp");
    const { draft } = await seedAgentDraft(fp);
    await ignoreUDraft(draft.id);
    const result = await approveUDraft(draft.id, { channel: "dashboard", approver: "haim" });
    expect(result.ok).toBe(false);
  });
});

describe("actionables-store: GET /api/decisions — one card per conversation", () => {
  it("shows a pending agent-store draft as one card with no code/importance fields", async () => {
    const fp = nid("fp");
    await seedAgentDraft(fp);
    const payload = (await (await decisionsGet()).json()) as any;
    const card = payload.cards.find((c: any) => c.id.endsWith(fp) === false && c.conversationKey === fp);
    expect(card).toBeTruthy();
    expect(card.id.startsWith("draft:")).toBe(true);
    expect(card.donnaReply.bubbles.length).toBeGreaterThan(0);
    expect(card.canApprove).toBe(true);
    expect(card.canSuggest).toBe(true);
    expect(card.canDisapprove).toBe(true);
    expect(card.canIgnore).toBe(true);
    expect(card.code).toBeUndefined();
    expect(card.importance).toBeUndefined();
    expect(card.senderName).toBe("Carlos from Nanjong");
  });

  it("shows the dropdown of all products when the chat isn't linked yet", async () => {
    const p1 = blankProduct({ name: "Safety Vest" });
    const p2 = blankProduct({ name: "Mop Head" });
    await saveProduct(p1);
    await saveProduct(p2);
    const fp = nid("fp");
    await seedAgentDraft(fp);
    const payload = (await (await decisionsGet()).json()) as any;
    const card = payload.cards.find((c: any) => c.conversationKey === fp);
    expect(card.productLinked).toBe(false);
    expect(card.allProducts.map((p: any) => p.name)).toEqual(expect.arrayContaining(["Safety Vest", "Mop Head"]));
  });

  it("linking a conversation to a product makes it show up as linked afterwards", async () => {
    const product = blankProduct({ name: "Safety Vest" });
    await saveProduct(product);
    const fp = nid("fp");
    await seedAgentDraft(fp);

    const factory = await linkConversationToProduct(fp, product.id, "Nanjong Industrial");
    expect(factory.productId).toBe(product.id);
    expect(factory.agentFactoryProductId).toBe(fp);

    const found = await findFactoryByConversation(fp);
    expect(found?.productId).toBe(product.id);

    const payload = (await (await decisionsGet()).json()) as any;
    const card = payload.cards.find((c: any) => c.conversationKey === fp);
    expect(card.productLinked).toBe(true);
    expect(card.productName).toBe("Safety Vest");

    // Idempotent: linking again returns the same factory, doesn't duplicate.
    const again = await linkConversationToProduct(fp, product.id, "Nanjong Industrial");
    expect(again.id).toBe(factory.id);
    expect(await listFactories(product.id)).toHaveLength(1);
  });
});

describe("actionables-store: fee question (no draft, still one card, real send on approve)", () => {
  it("approving a fee question queues exactly the shown @Yuki message", async () => {
    const fp = nid("fp");
    const chat = await dbInsert("chats", {
      external_id: `whatsapp:${nid("chat")}`,
      channel: "whatsapp",
      name: "Fee Factory",
      kind: "group",
    });
    await dbInsert("messages", {
      external_id: nid("msg"),
      chat_id: chat.id,
      factory_product_id: fp,
      direction: "in",
      text: "样品费200",
      translation: "Sample fee 200.",
      sent_at: Date.now(),
    });
    const q: Question = {
      id: nid("q"),
      factoryProductId: fp,
      kind: "fee",
      body: { amount: "200", currency: "RMB", covers: "3 samples", factory: "Fee Factory" },
      status: "open",
      answer: null,
      importance: "high",
      createdAt: Date.now(),
    };
    await saveQuestion(q);

    const payload = (await (await decisionsGet()).json()) as any;
    const card = payload.cards.find((c: any) => c.conversationKey === fp);
    expect(card.id).toBe(`question:${q.id}`);
    expect(card.decisionNeeded).toContain(resolveFeeMessage(q.body as any));
    expect(card.canApprove).toBe(true);

    const result = await approveUQuestion(q.id);
    expect(result.ok).toBe(true);
    const rows = await dbFind("outbox", (x: any) => x.draft_version_id === `fee:${q.id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].bubbles).toEqual([resolveFeeMessage(q.body as any)]);
  });

  it("suggest changes on a fee stays open in the same card (found via manual browser testing)", async () => {
    const fp = nid("fp");
    const q: Question = {
      id: nid("q"),
      factoryProductId: fp,
      kind: "fee",
      body: { amount: "200", currency: "RMB", covers: "3 samples", factory: "Fee Factory" },
      status: "open",
      answer: null,
      importance: "high",
      createdAt: Date.now(),
    };
    await saveQuestion(q);

    const result = await suggestChangesOnQuestion(q.id, "Ask for a formal invoice first");
    expect(result.ok).toBe(true);

    const payload = (await (await decisionsGet()).json()) as any;
    const card = payload.cards.find((c: any) => c.conversationKey === fp);
    expect(card).toBeTruthy(); // still there — not closed out
    expect(card.decisionNeeded).toContain("Ask for a formal invoice first");
    expect(card.canApprove).toBe(true); // still approvable afterwards
  });
});
