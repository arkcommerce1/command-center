// Dual-backend store: Vercel Postgres in prod (DATABASE_URL set),
// file-backed JSON locally (dev/verify). Same API both ways.
import { promises as fs } from "fs";
import path from "path";
import {
  ActivityActor,
  ActivityLogEntry,
  Adjustment,
  AgentJob,
  Chat,
  ChatMember,
  Contact,
  ContactChannel,
  Decision,
  Draft,
  DraftVersion,
  Factory,
  FactoryProduct,
  FactoryProductLink,
  LayerProof,
  Message,
  Notification,
  normSettings,
  OpenItem,
  OutboxRow,
  PlaybookSettings,
  Product,
  Question,
  QuoteRow,
  Sample,
  Shipment,
  ShipmentItem,
  SpecVersionRow,
  uid,
  UndoPlan,
  planUndo,
} from "@/lib/cc/types";

const DATA_FILE = path.join(process.cwd(), "data", "store.json");
const usePg = !!process.env.DATABASE_URL;

interface LocalData {
  products: Product[];
  factories: Factory[];
  contacts: Contact[];
  drafts: Draft[];
  draftVersions: DraftVersion[];
  layerProofs: LayerProof[];
  decisions: Decision[];
  factoryProductLinks: FactoryProductLink[];
  settings?: PlaybookSettings;
  specVersions: SpecVersionRow[];
  factoryProducts: FactoryProduct[];
  adjustments: Adjustment[];
  contactChannels: ContactChannel[];
  chats: Chat[];
  chatMembers: ChatMember[];
  messages: Message[];
  outbox: OutboxRow[];
  questions: Question[];
  quotes: QuoteRow[];
  openItems: OpenItem[];
  samples: Sample[];
  shipments: Shipment[];
  shipmentItems: ShipmentItem[];
  notifications: Notification[];
  activityLog: ActivityLogEntry[];
  agentJobs: AgentJob[];
}

const LOCAL_LIST_KEYS = [
  "contacts",
  "drafts",
  "draftVersions",
  "layerProofs",
  "decisions",
  "factoryProductLinks",
  "specVersions",
  "factoryProducts",
  "adjustments",
  "contactChannels",
  "chats",
  "chatMembers",
  "messages",
  "outbox",
  "questions",
  "quotes",
  "openItems",
  "samples",
  "shipments",
  "shipmentItems",
  "notifications",
  "activityLog",
  "agentJobs",
] as const;

const EMPTY_LOCAL: LocalData = {
  products: [],
  factories: [],
  contacts: [],
  drafts: [],
  draftVersions: [],
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
  questions: [],
  quotes: [],
  openItems: [],
  samples: [],
  shipments: [],
  shipmentItems: [],
  notifications: [],
  activityLog: [],
  agentJobs: [],
};

async function readLocal(): Promise<LocalData> {
  try {
    const d = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    for (const k of LOCAL_LIST_KEYS) d[k] = d[k] || [];
    return d;
  } catch {
    return structuredClone(EMPTY_LOCAL);
  }
}

async function writeLocal(data: Partial<LocalData>) {
  const full = { ...(await readLocal()), ...data };
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(full, null, 1));
}

async function pg() {
  const { sql } = await import("./pg-adapter");
  return sql;
}

export async function pgInit() {
  if (!usePg) return;
  const sql = await pg();
  await sql`CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS factories (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, factory_product_id TEXT NOT NULL, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS draft_versions (id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS layer_proofs (id TEXT PRIMARY KEY, factory_product_id TEXT NOT NULL, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, factory_product_id TEXT NOT NULL, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS factory_product_links (id TEXT PRIMARY KEY, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS spec_versions (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS factory_products (id TEXT PRIMARY KEY, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS adjustments (id TEXT PRIMARY KEY, factory_product_id TEXT NOT NULL, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS contact_channels (id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS chat_members (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, factory_product_id TEXT NOT NULL, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS open_items (id TEXT PRIMARY KEY, factory_product_id TEXT NOT NULL, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS samples (id TEXT PRIMARY KEY, factory_product_id TEXT NOT NULL, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS shipments (id TEXT PRIMARY KEY, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS shipment_items (id TEXT PRIMARY KEY, shipment_id TEXT NOT NULL, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS activity_log (id TEXT PRIMARY KEY, data JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS agent_jobs (id TEXT PRIMARY KEY, data JSONB NOT NULL)`;
}

// --- Playbook settings (single-row config) ---
const SETTINGS_ID = "singleton";

export async function getSettings(): Promise<PlaybookSettings> {
  if (!usePg) {
    const d = await readLocal();
    return normSettings(d.settings);
  }
  const sql = await pg();
  const r = await sql`SELECT data FROM settings WHERE id=${SETTINGS_ID}`;
  return normSettings(r.rows[0]?.data);
}

export async function saveSettings(s: PlaybookSettings): Promise<PlaybookSettings> {
  const normalized = normSettings(s);
  if (!usePg) {
    const d = await readLocal();
    d.settings = normalized;
    await writeLocal(d);
    return normalized;
  }
  const sql = await pg();
  await sql`INSERT INTO settings (id, data) VALUES (${SETTINGS_ID}, ${JSON.stringify(normalized)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
  return normalized;
}

export async function listContacts(): Promise<Contact[]> {
  if (!usePg) return (await readLocal()).contacts || [];
  const sql = await pg();
  const r = await sql`SELECT data FROM contacts ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as Contact);
}

export async function getContact(id: string): Promise<Contact | null> {
  if (!usePg) return ((await readLocal()).contacts || []).find((c) => c.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM contacts WHERE id=${id}`;
  return (r.rows[0]?.data as Contact) ?? null;
}

export async function saveContact(c: Contact) {
  if (!usePg) {
    const d = await readLocal();
    d.contacts = d.contacts || [];
    const i = d.contacts.findIndex((x) => x.id === c.id);
    if (i >= 0) d.contacts[i] = c; else d.contacts.push(c);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO contacts (id, data) VALUES (${c.id}, ${JSON.stringify(c)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
}

export async function deleteContact(id: string) {
  if (!usePg) {
    const d = await readLocal();
    d.contacts = (d.contacts || []).filter((c) => c.id !== id);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`DELETE FROM contacts WHERE id=${id}`;
}

export async function listProducts(): Promise<Product[]> {
  if (!usePg) return (await readLocal()).products;
  const sql = await pg();
  const r = await sql`SELECT data FROM products ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as Product);
}

export async function getProduct(id: string): Promise<Product | null> {
  if (!usePg) return (await readLocal()).products.find((p) => p.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM products WHERE id=${id}`;
  return (r.rows[0]?.data as Product) ?? null;
}

export async function saveProduct(p: Product) {
  if (!usePg) {
    const d = await readLocal();
    const i = d.products.findIndex((x) => x.id === p.id);
    if (i >= 0) d.products[i] = p; else d.products.push(p);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO products (id, data) VALUES (${p.id}, ${JSON.stringify(p)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
}

export async function deleteProduct(id: string) {
  if (!usePg) {
    const d = await readLocal();
    d.products = d.products.filter((p) => p.id !== id);
    d.factories = d.factories.filter((f) => f.productId !== id);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`DELETE FROM factories WHERE product_id=${id}`;
  await sql`DELETE FROM products WHERE id=${id}`;
}

export async function listFactories(productId: string): Promise<Factory[]> {
  if (!usePg) return (await readLocal()).factories.filter((f) => f.productId === productId);
  const sql = await pg();
  const r = await sql`SELECT data FROM factories WHERE product_id=${productId}`;
  return r.rows.map((x: any) => x.data as Factory);
}

export async function getFactory(id: string): Promise<Factory | null> {
  if (!usePg) return (await readLocal()).factories.find((f) => f.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM factories WHERE id=${id}`;
  return (r.rows[0]?.data as Factory) ?? null;
}

export async function saveFactory(f: Factory) {
  f.updatedAt = Date.now();
  if (!usePg) {
    const d = await readLocal();
    const i = d.factories.findIndex((x) => x.id === f.id);
    if (i >= 0) d.factories[i] = f; else d.factories.push(f);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO factories (id, product_id, data) VALUES (${f.id}, ${f.productId}, ${JSON.stringify(f)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET product_id=EXCLUDED.product_id, data=EXCLUDED.data`;
}

export async function deleteFactory(id: string) {
  if (!usePg) {
    const d = await readLocal();
    d.factories = d.factories.filter((f) => f.id !== id);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`DELETE FROM factories WHERE id=${id}`;
}

// --- Drafts ---

export async function listDrafts(factoryProductId?: string): Promise<Draft[]> {
  if (!usePg) {
    const all = (await readLocal()).drafts || [];
    return factoryProductId ? all.filter((x) => x.factoryProductId === factoryProductId) : all;
  }
  const sql = await pg();
  const r = factoryProductId
    ? await sql`SELECT data FROM drafts WHERE factory_product_id=${factoryProductId} ORDER BY data->>'createdAt' DESC`
    : await sql`SELECT data FROM drafts ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as Draft);
}

export async function getDraft(id: string): Promise<Draft | null> {
  if (!usePg) return ((await readLocal()).drafts || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM drafts WHERE id=${id}`;
  return (r.rows[0]?.data as Draft) ?? null;
}

export async function saveDraft(x: Draft) {
  if (!usePg) {
    const d = await readLocal();
    d.drafts = d.drafts || [];
    const i = d.drafts.findIndex((y) => y.id === x.id);
    if (i >= 0) d.drafts[i] = x; else d.drafts.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO drafts (id, factory_product_id, data) VALUES (${x.id}, ${x.factoryProductId}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET factory_product_id=EXCLUDED.factory_product_id, data=EXCLUDED.data`;
}

// --- Draft Versions ---

export async function listDraftVersions(draftId: string): Promise<DraftVersion[]> {
  if (!usePg) return ((await readLocal()).draftVersions || []).filter((x) => x.draftId === draftId);
  const sql = await pg();
  const r = await sql`SELECT data FROM draft_versions WHERE draft_id=${draftId} ORDER BY data->>'versionNumber' ASC`;
  return r.rows.map((x: any) => x.data as DraftVersion);
}

export async function getDraftVersion(id: string): Promise<DraftVersion | null> {
  if (!usePg) return ((await readLocal()).draftVersions || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM draft_versions WHERE id=${id}`;
  return (r.rows[0]?.data as DraftVersion) ?? null;
}

export async function saveDraftVersion(x: DraftVersion) {
  if (!usePg) {
    const d = await readLocal();
    d.draftVersions = d.draftVersions || [];
    const i = d.draftVersions.findIndex((y) => y.id === x.id);
    if (i >= 0) d.draftVersions[i] = x; else d.draftVersions.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO draft_versions (id, draft_id, data) VALUES (${x.id}, ${x.draftId}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET draft_id=EXCLUDED.draft_id, data=EXCLUDED.data`;
}

// --- Layer Proofs ---

export async function listLayerProofs(factoryProductId?: string): Promise<LayerProof[]> {
  if (!usePg) {
    const all = (await readLocal()).layerProofs || [];
    return factoryProductId ? all.filter((x) => x.factoryProductId === factoryProductId) : all;
  }
  const sql = await pg();
  const r = factoryProductId
    ? await sql`SELECT data FROM layer_proofs WHERE factory_product_id=${factoryProductId} ORDER BY data->>'markedAt' DESC`
    : await sql`SELECT data FROM layer_proofs ORDER BY data->>'markedAt' DESC`;
  return r.rows.map((x: any) => x.data as LayerProof);
}

export async function saveLayerProof(x: LayerProof) {
  if (!usePg) {
    const d = await readLocal();
    d.layerProofs = d.layerProofs || [];
    const i = d.layerProofs.findIndex((y) => y.id === x.id);
    if (i >= 0) d.layerProofs[i] = x; else d.layerProofs.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO layer_proofs (id, factory_product_id, data) VALUES (${x.id}, ${x.factoryProductId}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET factory_product_id=EXCLUDED.factory_product_id, data=EXCLUDED.data`;
}

// --- Decisions ---

export async function listDecisions(factoryProductId?: string): Promise<Decision[]> {
  if (!usePg) {
    const all = (await readLocal()).decisions || [];
    return factoryProductId ? all.filter((x) => x.factoryProductId === factoryProductId) : all;
  }
  const sql = await pg();
  const r = factoryProductId
    ? await sql`SELECT data FROM decisions WHERE factory_product_id=${factoryProductId} ORDER BY data->>'createdAt' DESC`
    : await sql`SELECT data FROM decisions ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as Decision);
}

export async function getDecision(id: string): Promise<Decision | null> {
  if (!usePg) return ((await readLocal()).decisions || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM decisions WHERE id=${id}`;
  return (r.rows[0]?.data as Decision) ?? null;
}

export async function saveDecision(x: Decision) {
  if (!usePg) {
    const d = await readLocal();
    d.decisions = d.decisions || [];
    const i = d.decisions.findIndex((y) => y.id === x.id);
    if (i >= 0) d.decisions[i] = x; else d.decisions.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO decisions (id, factory_product_id, data) VALUES (${x.id}, ${x.factoryProductId}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET factory_product_id=EXCLUDED.factory_product_id, data=EXCLUDED.data`;
}

// --- Factory Product Links ---

export async function listFactoryProductLinks(): Promise<FactoryProductLink[]> {
  if (!usePg) return (await readLocal()).factoryProductLinks || [];
  const sql = await pg();
  const r = await sql`SELECT data FROM factory_product_links ORDER BY data->>'since' DESC`;
  return r.rows.map((x: any) => x.data as FactoryProductLink);
}

export async function getFactoryProductLink(id: string): Promise<FactoryProductLink | null> {
  if (!usePg) return ((await readLocal()).factoryProductLinks || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM factory_product_links WHERE id=${id}`;
  return (r.rows[0]?.data as FactoryProductLink) ?? null;
}

export async function saveFactoryProductLink(x: FactoryProductLink) {
  if (!usePg) {
    const d = await readLocal();
    d.factoryProductLinks = d.factoryProductLinks || [];
    const i = d.factoryProductLinks.findIndex((y) => y.id === x.id);
    if (i >= 0) d.factoryProductLinks[i] = x; else d.factoryProductLinks.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO factory_product_links (id, data) VALUES (${x.id}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
}

// --- SPEC §1.2 Goal 1 collections (same dual-backend pattern as above) ---

// Generic row delete used by the per-collection deletes below.
async function deleteRow(table: string, localKey: (typeof LOCAL_LIST_KEYS)[number], id: string) {
  if (!usePg) {
    const d = await readLocal();
    (d[localKey] as { id: string }[]) = ((d[localKey] as { id: string }[]) || []).filter((x) => x.id !== id);
    return writeLocal(d);
  }
  const sql = await pg();
  await (sql as any).query(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

// --- Spec versions ---

export async function listSpecVersions(productId?: string): Promise<SpecVersionRow[]> {
  if (!usePg) {
    const all = (await readLocal()).specVersions || [];
    return productId ? all.filter((x) => x.productId === productId) : all;
  }
  const sql = await pg();
  const r = productId
    ? await sql`SELECT data FROM spec_versions WHERE product_id=${productId} ORDER BY data->>'createdAt' DESC`
    : await sql`SELECT data FROM spec_versions ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as SpecVersionRow);
}

export async function getSpecVersion(id: string): Promise<SpecVersionRow | null> {
  if (!usePg) return ((await readLocal()).specVersions || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM spec_versions WHERE id=${id}`;
  return (r.rows[0]?.data as SpecVersionRow) ?? null;
}

export async function saveSpecVersion(x: SpecVersionRow) {
  if (!usePg) {
    const d = await readLocal();
    d.specVersions = d.specVersions || [];
    const i = d.specVersions.findIndex((y) => y.id === x.id);
    if (i >= 0) d.specVersions[i] = x; else d.specVersions.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO spec_versions (id, product_id, data) VALUES (${x.id}, ${x.productId}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET product_id=EXCLUDED.product_id, data=EXCLUDED.data`;
}

export async function deleteSpecVersion(id: string) {
  return deleteRow("spec_versions", "specVersions", id);
}

// --- Factory products (factory+product pair rows, P11) ---

export async function listFactoryProducts(): Promise<FactoryProduct[]> {
  if (!usePg) return (await readLocal()).factoryProducts || [];
  const sql = await pg();
  const r = await sql`SELECT data FROM factory_products ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as FactoryProduct);
}

export async function getFactoryProduct(id: string): Promise<FactoryProduct | null> {
  if (!usePg) return ((await readLocal()).factoryProducts || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM factory_products WHERE id=${id}`;
  return (r.rows[0]?.data as FactoryProduct) ?? null;
}

export async function saveFactoryProduct(x: FactoryProduct) {
  if (!usePg) {
    const d = await readLocal();
    d.factoryProducts = d.factoryProducts || [];
    const i = d.factoryProducts.findIndex((y) => y.id === x.id);
    if (i >= 0) d.factoryProducts[i] = x; else d.factoryProducts.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO factory_products (id, data) VALUES (${x.id}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
}

export async function deleteFactoryProduct(id: string) {
  return deleteRow("factory_products", "factoryProducts", id);
}

// --- Adjustments ---

export async function listAdjustments(factoryProductId?: string): Promise<Adjustment[]> {
  if (!usePg) {
    const all = (await readLocal()).adjustments || [];
    return factoryProductId ? all.filter((x) => x.factoryProductId === factoryProductId) : all;
  }
  const sql = await pg();
  const r = factoryProductId
    ? await sql`SELECT data FROM adjustments WHERE factory_product_id=${factoryProductId} ORDER BY data->>'createdAt' DESC`
    : await sql`SELECT data FROM adjustments ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as Adjustment);
}

export async function getAdjustment(id: string): Promise<Adjustment | null> {
  if (!usePg) return ((await readLocal()).adjustments || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM adjustments WHERE id=${id}`;
  return (r.rows[0]?.data as Adjustment) ?? null;
}

export async function saveAdjustment(x: Adjustment) {
  if (!usePg) {
    const d = await readLocal();
    d.adjustments = d.adjustments || [];
    const i = d.adjustments.findIndex((y) => y.id === x.id);
    if (i >= 0) d.adjustments[i] = x; else d.adjustments.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO adjustments (id, factory_product_id, data) VALUES (${x.id}, ${x.factoryProductId}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET factory_product_id=EXCLUDED.factory_product_id, data=EXCLUDED.data`;
}

export async function deleteAdjustment(id: string) {
  return deleteRow("adjustments", "adjustments", id);
}

// --- Contact channels ---

export async function listContactChannels(contactId?: string): Promise<ContactChannel[]> {
  if (!usePg) {
    const all = (await readLocal()).contactChannels || [];
    return contactId ? all.filter((x) => x.contactId === contactId) : all;
  }
  const sql = await pg();
  const r = contactId
    ? await sql`SELECT data FROM contact_channels WHERE contact_id=${contactId} ORDER BY data->>'createdAt' DESC`
    : await sql`SELECT data FROM contact_channels ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as ContactChannel);
}

export async function getContactChannel(id: string): Promise<ContactChannel | null> {
  if (!usePg) return ((await readLocal()).contactChannels || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM contact_channels WHERE id=${id}`;
  return (r.rows[0]?.data as ContactChannel) ?? null;
}

export async function saveContactChannel(x: ContactChannel) {
  if (!usePg) {
    const d = await readLocal();
    d.contactChannels = d.contactChannels || [];
    const i = d.contactChannels.findIndex((y) => y.id === x.id);
    if (i >= 0) d.contactChannels[i] = x; else d.contactChannels.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO contact_channels (id, contact_id, data) VALUES (${x.id}, ${x.contactId}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET contact_id=EXCLUDED.contact_id, data=EXCLUDED.data`;
}

export async function deleteContactChannel(id: string) {
  return deleteRow("contact_channels", "contactChannels", id);
}

// --- Chats ---

export async function listChats(): Promise<Chat[]> {
  if (!usePg) return (await readLocal()).chats || [];
  const sql = await pg();
  const r = await sql`SELECT data FROM chats ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as Chat);
}

export async function getChat(id: string): Promise<Chat | null> {
  if (!usePg) return ((await readLocal()).chats || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM chats WHERE id=${id}`;
  return (r.rows[0]?.data as Chat) ?? null;
}

export async function saveChat(x: Chat) {
  if (!usePg) {
    const d = await readLocal();
    d.chats = d.chats || [];
    const i = d.chats.findIndex((y) => y.id === x.id);
    if (i >= 0) d.chats[i] = x; else d.chats.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO chats (id, data) VALUES (${x.id}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
}

export async function deleteChat(id: string) {
  return deleteRow("chats", "chats", id);
}

// --- Chat members ---

export async function listChatMembers(chatId?: string): Promise<ChatMember[]> {
  if (!usePg) {
    const all = (await readLocal()).chatMembers || [];
    return chatId ? all.filter((x) => x.chatId === chatId) : all;
  }
  const sql = await pg();
  const r = chatId
    ? await sql`SELECT data FROM chat_members WHERE chat_id=${chatId}`
    : await sql`SELECT data FROM chat_members`;
  return r.rows.map((x: any) => x.data as ChatMember);
}

export async function getChatMember(id: string): Promise<ChatMember | null> {
  if (!usePg) return ((await readLocal()).chatMembers || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM chat_members WHERE id=${id}`;
  return (r.rows[0]?.data as ChatMember) ?? null;
}

export async function saveChatMember(x: ChatMember) {
  if (!usePg) {
    const d = await readLocal();
    d.chatMembers = d.chatMembers || [];
    const i = d.chatMembers.findIndex((y) => y.id === x.id);
    if (i >= 0) d.chatMembers[i] = x; else d.chatMembers.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO chat_members (id, chat_id, data) VALUES (${x.id}, ${x.chatId}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET chat_id=EXCLUDED.chat_id, data=EXCLUDED.data`;
}

export async function deleteChatMember(id: string) {
  return deleteRow("chat_members", "chatMembers", id);
}

// --- Messages ---

export async function listMessages(chatId?: string): Promise<Message[]> {
  if (!usePg) {
    const all = (await readLocal()).messages || [];
    return chatId ? all.filter((x) => x.chatId === chatId) : all;
  }
  const sql = await pg();
  const r = chatId
    ? await sql`SELECT data FROM messages WHERE chat_id=${chatId} ORDER BY data->>'sentAt' ASC`
    : await sql`SELECT data FROM messages ORDER BY data->>'sentAt' ASC`;
  return r.rows.map((x: any) => x.data as Message);
}

export async function getMessage(id: string): Promise<Message | null> {
  if (!usePg) return ((await readLocal()).messages || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM messages WHERE id=${id}`;
  return (r.rows[0]?.data as Message) ?? null;
}

export async function saveMessage(x: Message) {
  if (!usePg) {
    const d = await readLocal();
    d.messages = d.messages || [];
    const i = d.messages.findIndex((y) => y.id === x.id);
    if (i >= 0) d.messages[i] = x; else d.messages.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO messages (id, chat_id, data) VALUES (${x.id}, ${x.chatId}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET chat_id=EXCLUDED.chat_id, data=EXCLUDED.data`;
}

export async function deleteMessage(id: string) {
  return deleteRow("messages", "messages", id);
}

// --- Outbox ---

export async function listOutbox(): Promise<OutboxRow[]> {
  if (!usePg) return (await readLocal()).outbox || [];
  const sql = await pg();
  const r = await sql`SELECT data FROM outbox ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as OutboxRow);
}

export async function getOutboxRow(id: string): Promise<OutboxRow | null> {
  if (!usePg) return ((await readLocal()).outbox || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM outbox WHERE id=${id}`;
  return (r.rows[0]?.data as OutboxRow) ?? null;
}

export async function saveOutboxRow(x: OutboxRow) {
  if (!usePg) {
    const d = await readLocal();
    d.outbox = d.outbox || [];
    const i = d.outbox.findIndex((y) => y.id === x.id);
    if (i >= 0) d.outbox[i] = x; else d.outbox.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO outbox (id, data) VALUES (${x.id}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
}

export async function deleteOutboxRow(id: string) {
  return deleteRow("outbox", "outbox", id);
}

// --- Questions ---

export async function listQuestions(): Promise<Question[]> {
  if (!usePg) return (await readLocal()).questions || [];
  const sql = await pg();
  const r = await sql`SELECT data FROM questions ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as Question);
}

export async function getQuestion(id: string): Promise<Question | null> {
  if (!usePg) return ((await readLocal()).questions || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM questions WHERE id=${id}`;
  return (r.rows[0]?.data as Question) ?? null;
}

export async function saveQuestion(x: Question) {
  if (!usePg) {
    const d = await readLocal();
    d.questions = d.questions || [];
    const i = d.questions.findIndex((y) => y.id === x.id);
    if (i >= 0) d.questions[i] = x; else d.questions.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO questions (id, data) VALUES (${x.id}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
}

export async function deleteQuestion(id: string) {
  return deleteRow("questions", "questions", id);
}

// --- Quotes (Haim only, P3) ---

export async function listQuotes(factoryProductId?: string): Promise<QuoteRow[]> {
  if (!usePg) {
    const all = (await readLocal()).quotes || [];
    return factoryProductId ? all.filter((x) => x.factoryProductId === factoryProductId) : all;
  }
  const sql = await pg();
  const r = factoryProductId
    ? await sql`SELECT data FROM quotes WHERE factory_product_id=${factoryProductId} ORDER BY data->>'createdAt' DESC`
    : await sql`SELECT data FROM quotes ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as QuoteRow);
}

export async function getQuote(id: string): Promise<QuoteRow | null> {
  if (!usePg) return ((await readLocal()).quotes || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM quotes WHERE id=${id}`;
  return (r.rows[0]?.data as QuoteRow) ?? null;
}

export async function saveQuote(x: QuoteRow) {
  if (!usePg) {
    const d = await readLocal();
    d.quotes = d.quotes || [];
    const i = d.quotes.findIndex((y) => y.id === x.id);
    if (i >= 0) d.quotes[i] = x; else d.quotes.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO quotes (id, factory_product_id, data) VALUES (${x.id}, ${x.factoryProductId}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET factory_product_id=EXCLUDED.factory_product_id, data=EXCLUDED.data`;
}

export async function deleteQuote(id: string) {
  return deleteRow("quotes", "quotes", id);
}

// --- Open items ---

export async function listOpenItems(factoryProductId?: string): Promise<OpenItem[]> {
  if (!usePg) {
    const all = (await readLocal()).openItems || [];
    return factoryProductId ? all.filter((x) => x.factoryProductId === factoryProductId) : all;
  }
  const sql = await pg();
  const r = factoryProductId
    ? await sql`SELECT data FROM open_items WHERE factory_product_id=${factoryProductId} ORDER BY data->>'openedAt' DESC`
    : await sql`SELECT data FROM open_items ORDER BY data->>'openedAt' DESC`;
  return r.rows.map((x: any) => x.data as OpenItem);
}

export async function getOpenItem(id: string): Promise<OpenItem | null> {
  if (!usePg) return ((await readLocal()).openItems || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM open_items WHERE id=${id}`;
  return (r.rows[0]?.data as OpenItem) ?? null;
}

export async function saveOpenItem(x: OpenItem) {
  if (!usePg) {
    const d = await readLocal();
    d.openItems = d.openItems || [];
    const i = d.openItems.findIndex((y) => y.id === x.id);
    if (i >= 0) d.openItems[i] = x; else d.openItems.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO open_items (id, factory_product_id, data) VALUES (${x.id}, ${x.factoryProductId}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET factory_product_id=EXCLUDED.factory_product_id, data=EXCLUDED.data`;
}

export async function deleteOpenItem(id: string) {
  return deleteRow("open_items", "openItems", id);
}

// --- Samples ---

export async function listSamples(factoryProductId?: string): Promise<Sample[]> {
  if (!usePg) {
    const all = (await readLocal()).samples || [];
    return factoryProductId ? all.filter((x) => x.factoryProductId === factoryProductId) : all;
  }
  const sql = await pg();
  const r = factoryProductId
    ? await sql`SELECT data FROM samples WHERE factory_product_id=${factoryProductId} ORDER BY data->>'createdAt' DESC`
    : await sql`SELECT data FROM samples ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as Sample);
}

export async function getSample(id: string): Promise<Sample | null> {
  if (!usePg) return ((await readLocal()).samples || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM samples WHERE id=${id}`;
  return (r.rows[0]?.data as Sample) ?? null;
}

export async function saveSample(x: Sample) {
  if (!usePg) {
    const d = await readLocal();
    d.samples = d.samples || [];
    const i = d.samples.findIndex((y) => y.id === x.id);
    if (i >= 0) d.samples[i] = x; else d.samples.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO samples (id, factory_product_id, data) VALUES (${x.id}, ${x.factoryProductId}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET factory_product_id=EXCLUDED.factory_product_id, data=EXCLUDED.data`;
}

export async function deleteSample(id: string) {
  return deleteRow("samples", "samples", id);
}

// --- Shipments ---

export async function listShipments(): Promise<Shipment[]> {
  if (!usePg) return (await readLocal()).shipments || [];
  const sql = await pg();
  const r = await sql`SELECT data FROM shipments ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as Shipment);
}

export async function getShipment(id: string): Promise<Shipment | null> {
  if (!usePg) return ((await readLocal()).shipments || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM shipments WHERE id=${id}`;
  return (r.rows[0]?.data as Shipment) ?? null;
}

export async function saveShipment(x: Shipment) {
  if (!usePg) {
    const d = await readLocal();
    d.shipments = d.shipments || [];
    const i = d.shipments.findIndex((y) => y.id === x.id);
    if (i >= 0) d.shipments[i] = x; else d.shipments.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO shipments (id, data) VALUES (${x.id}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
}

export async function deleteShipment(id: string) {
  return deleteRow("shipments", "shipments", id);
}

// --- Shipment items ---

export async function listShipmentItems(shipmentId?: string): Promise<ShipmentItem[]> {
  if (!usePg) {
    const all = (await readLocal()).shipmentItems || [];
    return shipmentId ? all.filter((x) => x.shipmentId === shipmentId) : all;
  }
  const sql = await pg();
  const r = shipmentId
    ? await sql`SELECT data FROM shipment_items WHERE shipment_id=${shipmentId}`
    : await sql`SELECT data FROM shipment_items`;
  return r.rows.map((x: any) => x.data as ShipmentItem);
}

export async function getShipmentItem(id: string): Promise<ShipmentItem | null> {
  if (!usePg) return ((await readLocal()).shipmentItems || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM shipment_items WHERE id=${id}`;
  return (r.rows[0]?.data as ShipmentItem) ?? null;
}

export async function saveShipmentItem(x: ShipmentItem) {
  if (!usePg) {
    const d = await readLocal();
    d.shipmentItems = d.shipmentItems || [];
    const i = d.shipmentItems.findIndex((y) => y.id === x.id);
    if (i >= 0) d.shipmentItems[i] = x; else d.shipmentItems.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO shipment_items (id, shipment_id, data) VALUES (${x.id}, ${x.shipmentId}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET shipment_id=EXCLUDED.shipment_id, data=EXCLUDED.data`;
}

export async function deleteShipmentItem(id: string) {
  return deleteRow("shipment_items", "shipmentItems", id);
}

// --- Notifications (Donna to Ours contacts only, sent automatically) ---

export async function listNotifications(): Promise<Notification[]> {
  if (!usePg) return (await readLocal()).notifications || [];
  const sql = await pg();
  const r = await sql`SELECT data FROM notifications ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as Notification);
}

export async function getNotification(id: string): Promise<Notification | null> {
  if (!usePg) return ((await readLocal()).notifications || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM notifications WHERE id=${id}`;
  return (r.rows[0]?.data as Notification) ?? null;
}

export async function saveNotification(x: Notification) {
  if (!usePg) {
    const d = await readLocal();
    d.notifications = d.notifications || [];
    const i = d.notifications.findIndex((y) => y.id === x.id);
    if (i >= 0) d.notifications[i] = x; else d.notifications.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO notifications (id, data) VALUES (${x.id}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
}

export async function deleteNotification(id: string) {
  return deleteRow("notifications", "notifications", id);
}

// --- Activity log (P10: automatic non-message actions logged with Undo) ---

export async function listActivity(): Promise<ActivityLogEntry[]> {
  if (!usePg) return (await readLocal()).activityLog || [];
  const sql = await pg();
  const r = await sql`SELECT data FROM activity_log ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as ActivityLogEntry);
}

export async function getActivityEntry(id: string): Promise<ActivityLogEntry | null> {
  if (!usePg) return ((await readLocal()).activityLog || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM activity_log WHERE id=${id}`;
  return (r.rows[0]?.data as ActivityLogEntry) ?? null;
}

export async function saveActivityEntry(x: ActivityLogEntry) {
  if (!usePg) {
    const d = await readLocal();
    d.activityLog = d.activityLog || [];
    const i = d.activityLog.findIndex((y) => y.id === x.id);
    if (i >= 0) d.activityLog[i] = x; else d.activityLog.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO activity_log (id, data) VALUES (${x.id}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
}

export async function deleteActivityEntry(id: string) {
  return deleteRow("activity_log", "activityLog", id);
}

export async function logActivity(
  actor: ActivityActor,
  action: string,
  entity: string,
  entityId: string,
  before: any,
  after: any,
  undoable: boolean,
): Promise<ActivityLogEntry> {
  const entry: ActivityLogEntry = {
    id: uid(),
    actor,
    action,
    entity,
    entityId,
    before: before ?? null,
    after: after ?? null,
    undoable,
    undoneAt: null,
    createdAt: Date.now(),
  };
  await saveActivityEntry(entry);
  return entry;
}

// --- Agent jobs ---

export async function listAgentJobs(): Promise<AgentJob[]> {
  if (!usePg) return (await readLocal()).agentJobs || [];
  const sql = await pg();
  const r = await sql`SELECT data FROM agent_jobs ORDER BY data->>'createdAt' DESC`;
  return r.rows.map((x: any) => x.data as AgentJob);
}

export async function getAgentJob(id: string): Promise<AgentJob | null> {
  if (!usePg) return ((await readLocal()).agentJobs || []).find((x) => x.id === id) ?? null;
  const sql = await pg();
  const r = await sql`SELECT data FROM agent_jobs WHERE id=${id}`;
  return (r.rows[0]?.data as AgentJob) ?? null;
}

export async function saveAgentJob(x: AgentJob) {
  if (!usePg) {
    const d = await readLocal();
    d.agentJobs = d.agentJobs || [];
    const i = d.agentJobs.findIndex((y) => y.id === x.id);
    if (i >= 0) d.agentJobs[i] = x; else d.agentJobs.push(x);
    return writeLocal(d);
  }
  const sql = await pg();
  await sql`INSERT INTO agent_jobs (id, data) VALUES (${x.id}, ${JSON.stringify(x)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
}

export async function deleteAgentJob(id: string) {
  return deleteRow("agent_jobs", "agentJobs", id);
}

// --- Undo (P10): reverse one undoable activity entry, then mark it undone ---

export type UndoError = "not_found" | "not_undoable" | "unsupported_collection";

async function applyUndoPlan(plan: UndoPlan): Promise<UndoError | null> {
  const { collection, id, restore, remove } = plan;
  switch (collection) {
    case "contacts":
      if (remove) await deleteContact(id);
      else await saveContact(restore);
      return null;
    case "factory_products":
      if (remove) await deleteFactoryProduct(id);
      else await saveFactoryProduct(restore);
      return null;
    case "spec_versions":
      if (remove) await deleteSpecVersion(id);
      else await saveSpecVersion(restore);
      return null;
    case "adjustments":
      if (remove) await deleteAdjustment(id);
      else await saveAdjustment(restore);
      return null;
    case "contact_channels":
      if (remove) await deleteContactChannel(id);
      else await saveContactChannel(restore);
      return null;
    case "chats":
      if (remove) await deleteChat(id);
      else await saveChat(restore);
      return null;
    case "chat_members":
      if (remove) await deleteChatMember(id);
      else await saveChatMember(restore);
      return null;
    case "messages":
      if (remove) await deleteMessage(id);
      else await saveMessage(restore);
      return null;
    case "outbox":
      if (remove) await deleteOutboxRow(id);
      else await saveOutboxRow(restore);
      return null;
    case "questions":
      if (remove) await deleteQuestion(id);
      else await saveQuestion(restore);
      return null;
    case "quotes":
      if (remove) await deleteQuote(id);
      else await saveQuote(restore);
      return null;
    case "open_items":
      if (remove) await deleteOpenItem(id);
      else await saveOpenItem(restore);
      return null;
    case "samples":
      if (remove) await deleteSample(id);
      else await saveSample(restore);
      return null;
    case "shipments":
      if (remove) await deleteShipment(id);
      else await saveShipment(restore);
      return null;
    case "shipment_items":
      if (remove) await deleteShipmentItem(id);
      else await saveShipmentItem(restore);
      return null;
    case "notifications":
      if (remove) await deleteNotification(id);
      else await saveNotification(restore);
      return null;
    case "activity_log":
      if (remove) await deleteActivityEntry(id);
      else await saveActivityEntry(restore);
      return null;
    case "agent_jobs":
      if (remove) await deleteAgentJob(id);
      else await saveAgentJob(restore);
      return null;
    default:
      return "unsupported_collection";
  }
}

export async function undoActivityEntry(
  id: string,
): Promise<{ entry: ActivityLogEntry } | { error: UndoError }> {
  const entry = await getActivityEntry(id);
  if (!entry) return { error: "not_found" };
  const plan = planUndo(entry);
  if (!plan) return { error: "not_undoable" };
  const unsupported = await applyUndoPlan(plan);
  if (unsupported) return { error: unsupported };
  const done: ActivityLogEntry = { ...entry, undoneAt: Date.now() };
  await saveActivityEntry(done);
  return { entry: done };
}
