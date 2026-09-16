// Isolated file-backed store for the Agent API (§1.3).
// Kept separate from src/lib/cc/store.ts so a sibling task can add §1.2
// tables + store functions there without merge conflicts. Same dual pattern:
// file-backed JSON locally (data/agent.json); Postgres when DATABASE_URL is set.
import { promises as fs } from "fs";
import path from "path";
import { uid } from "@/lib/cc/types";

const DATA_FILE = path.join(process.cwd(), "data", "agent.json");
const usePg = () => !!process.env.DATABASE_URL;

export const LEASE_MS = 5 * 60 * 1000; // 5-minute lease

export interface AgentDb {
  chats: any[];
  chatMembers: any[];
  messages: any[];
  contacts: any[];
  factories: any[];
  factoryProducts: any[];
  agentJobs: any[];
  steps: any[];
  statusUpdates: any[];
  drafts: any[];
  draftVersions: any[];
  questions: any[];
  quotes: any[];
  adjustments: any[];
  openItems: any[];
  samples: any[];
  shipments: any[];
  shipmentItems: any[];
  notifications: any[];
  outbox: any[];
  activity: any[];
}

const EMPTY: AgentDb = {
  chats: [],
  chatMembers: [],
  messages: [],
  contacts: [],
  factories: [],
  factoryProducts: [],
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

// In-memory cache so rapid successive calls (and tests) share state.
let mem: AgentDb | null = null;

export function __resetAgentDb() {
  mem = null;
}

async function readDb(): Promise<AgentDb> {
  if (mem) return mem;
  if (usePg()) {
    const { sql } = await import("./pg-adapter");
    await sql`CREATE TABLE IF NOT EXISTS agent_kv (id TEXT PRIMARY KEY, data JSONB NOT NULL)`;
    const r = await sql`SELECT data FROM agent_kv WHERE id='db'`;
    mem = { ...structuredClone(EMPTY), ...((r.rows[0]?.data as object) ?? {}) };
    return mem;
  }
  try {
    const raw = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    mem = { ...structuredClone(EMPTY), ...raw };
  } catch {
    mem = structuredClone(EMPTY);
  }
  return mem!;
}

async function writeDb() {
  if (!mem) return;
  if (usePg()) {
    const { sql } = await import("./pg-adapter");
    await sql`INSERT INTO agent_kv (id, data) VALUES ('db', ${JSON.stringify(mem)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
    return;
  }
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(mem, null, 1));
  } catch {
    // Ephemeral FS (or read-only): keep serving from memory.
  }
}

export async function dbGet<K extends keyof AgentDb>(key: K): Promise<AgentDb[K]> {
  return (await readDb())[key];
}

export async function dbPut<K extends keyof AgentDb>(key: K, value: AgentDb[K]): Promise<void> {
  (await readDb())[key] = value;
  await writeDb();
}

export async function dbInsert<K extends keyof AgentDb>(key: K, row: any): Promise<any> {
  const d = await readDb();
  const r = { id: row.id || uid(), createdAt: Date.now(), ...row };
  (d[key] as any[]).push(r);
  await writeDb();
  return r;
}

export async function dbUpdate<K extends keyof AgentDb>(
  key: K,
  id: string,
  patch: Record<string, any>,
): Promise<any | null> {
  const d = await readDb();
  const arr = d[key] as any[];
  const i = arr.findIndex((x) => x.id === id);
  if (i < 0) return null;
  arr[i] = { ...arr[i], ...patch };
  await writeDb();
  return arr[i];
}

export async function dbFind<K extends keyof AgentDb>(key: K, pred: (x: any) => boolean): Promise<any[]> {
  return ((await readDb())[key] as any[]).filter(pred);
}

export async function dbById<K extends keyof AgentDb>(key: K, id: string): Promise<any | null> {
  return ((await readDb())[key] as any[]).find((x) => x.id === id) ?? null;
}

/** Lease helper: row is claimable when never leased or lease expired. */
export function leaseExpired(row: any, now = Date.now()): boolean {
  return !row.lease_expires_at || Number(row.lease_expires_at) <= now;
}

/**
 * Claim one row (outbox / notifications / jobs): sets lease_token +
 * lease_expires_at and returns it, or null when nothing is claimable.
 * Single-winner: only one caller gets a given row per lease window.
 */
export async function claimOne(
  key: "outbox" | "notifications" | "agentJobs",
  match: (x: any) => boolean,
  extra?: Record<string, any>,
  now = Date.now(),
): Promise<any | null> {
  const d = await readDb();
  const arr = d[key] as any[];
  const row = arr.find((x) => match(x) && leaseExpired(x, now));
  if (!row) return null;
  row.lease_token = uid();
  row.lease_expires_at = now + LEASE_MS;
  if (key === "agentJobs") row.status = "running";
  else if (key === "outbox") row.status = "sending";
  if (extra) Object.assign(row, extra);
  row.attempts = (row.attempts || 0) + 1;
  await writeDb();
  return { ...row };
}
