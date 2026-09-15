// Dual-backend store: Vercel Postgres in prod (DATABASE_URL set),
// file-backed JSON locally (dev/verify). Same API both ways.
import { promises as fs } from "fs";
import path from "path";
import { Factory, Product } from "@/lib/cc/types";

const DATA_FILE = path.join(process.cwd(), "data", "store.json");
const usePg = !!process.env.DATABASE_URL;

async function readLocal(): Promise<{ products: Product[]; factories: Factory[] }> {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch {
    return { products: [], factories: [] };
  }
}

async function writeLocal(data: { products: Product[]; factories: Factory[] }) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 1));
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
