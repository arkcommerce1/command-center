// Goal 7 local-e2e seed. Backs up data/store.json + data/agent.json,
// writes deterministic fixtures, restores with --restore.
// Run from the repo root: `node tests/e2e/seed-goal7.mjs [--restore]`
import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const storeFile = path.join(root, "data", "store.json");
const agentFile = path.join(root, "data", "agent.json");

const T0 = Date.now();

const store = {
  products: [],
  factories: [],
  contacts: [],
  drafts: [
    {
      id: "g7-draft-a",
      factoryProductId: "g7-fp-a",
      type: "reply",
      layer: 2,
      status: "pending",
      trigger: "factory sent photos, needs spec confirm",
      createdAt: T0 - 30000,
    },
    {
      id: "g7-draft-b",
      factoryProductId: "g7-fp-b",
      type: "nudge",
      layer: 4,
      status: "pending",
      trigger: "sample_tracking overdue",
      createdAt: T0 - 20000,
    },
  ],
  draftVersions: [
    {
      id: "g7-ver-a1",
      draftId: "g7-draft-a",
      versionNumber: 1,
      text: "Hi Mei, thanks for the photos.\n\nCould you confirm the fabric is 80% cotton?",
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
      createdAt: T0 - 30000,
    },
    {
      id: "g7-ver-b1",
      draftId: "g7-draft-b",
      versionNumber: 1,
      text: "Just floating this up.\n\nCould you share the tracking number when you have it?",
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
      createdAt: T0 - 20000,
    },
  ],
  layerProofs: [],
  decisions: [],
  factoryProductLinks: [],
  specVersions: [],
  factoryProducts: [],
  adjustments: [],
  contactChannels: [],
  chats: [],
  chatMembers: [],
  messages: [],
  outbox: [],
  questions: [
    {
      id: "g7-fee-1",
      factoryProductId: "g7-fp-a",
      kind: "fee",
      body: {
        amount: "200",
        currency: "RMB",
        covers: "3 samples",
        factory: "Demo Factory",
        factoryMessage: "样品费200元",
        yukiMessage:
          "@Yuki can you pay the sample fee of 200 RMB to Demo Factory from the China office? Covers: 3 samples.",
      },
      status: "open",
      answer: null,
      importance: "high",
      createdAt: T0 - 25000,
    },
    {
      id: "g7-q-1",
      factoryProductId: "g7-fp-b",
      kind: "question",
      body: { text: "Can you make it in blue?", translation: "Can you make it in blue?" },
      status: "open",
      answer: null,
      importance: "medium",
      createdAt: T0 - 15000,
    },
    {
      id: "g7-pick-1",
      factoryProductId: null,
      kind: "product_pick",
      body: {
        groupName: "Demo New Group",
        firstMessages: "Hello we are ABC co",
        likelyProducts: [
          { productId: "prod-1", name: "Mop Head" },
          { productId: "prod-2", name: "Bottle" },
        ],
      },
      status: "open",
      answer: null,
      importance: "medium",
      createdAt: T0 - 10000,
    },
  ],
  quotes: [],
  openItems: [],
  samples: [],
  shipments: [],
  shipmentItems: [],
  notifications: [],
  activityLog: [],
  agentJobs: [],
};

const agent = {
  chats: [
    {
      id: "g7-ag-chat",
      external_id: "whatsapp:111222333@g.us",
      channel: "whatsapp",
      name: "Demo Factory",
      kind: "group",
      createdAt: T0 - 40000,
    },
  ],
  chatMembers: [],
  messages: [
    {
      id: "g7-ag-m1",
      external_id: "wa:m1",
      chat_id: "g7-ag-chat",
      direction: "in",
      text: "这是样品照片",
      translation: "Here are the sample photos.",
      sent_at: T0 - 35000,
      factory_product_id: "g7-fp-a",
      createdAt: T0 - 35000,
    },
    {
      id: "g7-ag-m2",
      external_id: "wa:m2",
      chat_id: "g7-ag-chat",
      direction: "in",
      text: "稍等",
      translation: "One moment.",
      sent_at: T0 - 22000,
      factory_product_id: "g7-fp-b",
      createdAt: T0 - 22000,
    },
  ],
  contacts: [],
  agentJobs: [],
  steps: [],
  statusUpdates: [],
  drafts: [],
  draftVersions: [],
  questions: [],
  quotes: [],
  adjustments: [],
  openItems: [],
  samples: [],
  shipments: [],
  shipmentItems: [],
  notifications: [],
  outbox: [],
  activity: [],
};

async function readIfExists(p) {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

if (process.argv.includes("--restore")) {
  for (const [f, _bak] of [
    [storeFile, "store.json"],
    [agentFile, "agent.json"],
  ]) {
    const saved = await readIfExists(`${f}.bak-goal7`);
    if (saved == null) await fs.rm(f, { force: true });
    else await fs.writeFile(f, saved);
    await fs.rm(`${f}.bak-goal7`, { force: true });
  }
  console.log("goal7 seed restored");
} else {
  for (const [f] of [[storeFile], [agentFile]]) {
    if ((await readIfExists(`${f}.bak-goal7`)) == null) {
      const cur = await readIfExists(f);
      if (cur != null) await fs.writeFile(`${f}.bak-goal7`, cur);
    }
  }
  await fs.mkdir(path.dirname(storeFile), { recursive: true });
  await fs.writeFile(storeFile, JSON.stringify(store, null, 1));
  await fs.writeFile(agentFile, JSON.stringify(agent, null, 1));
  console.log("goal7 seed written");
}
