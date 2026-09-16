// Dual-backend store: Vercel Postgres in prod (DATABASE_URL set),
// file-backed JSON locally (dev/verify). Same API both ways.
import { promises as fs } from "fs";
import path from "path";
import {
  Contact,
  Decision,
  Draft,
  DraftVersion,
  Factory,
  FactoryProductLink,
  LayerProof,
  normSettings,
  PlaybookSettings,
  Product,
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
}

async function readLocal(): Promise<LocalData> {
  try {
    const d = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    d.contacts = d.contacts || [];
    d.drafts = d.drafts || [];
    d.draftVersions = d.draftVersions || [];
    d.layerProofs = d.layerProofs || [];
    d.decisions = d.decisions || [];
    d.factoryProductLinks = d.factoryProductLinks || [];
    return d;
  } catch {
    return { products: [], factories: [], contacts: [], drafts: [], draftVersions: [], layerProofs: [], decisions: [], factoryProductLinks: [] };
  }
}

async function writeLocal(data: Partial<LocalData>) {
  const full = { ...(await readLocal()), ...data };
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(full, null, 1));
}

async function pg() {
  const { sql } = await import("@vercel/postgres");
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
