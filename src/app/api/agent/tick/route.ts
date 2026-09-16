import { NextRequest, NextResponse } from "next/server";
import { agentAuth } from "@/lib/cc/agent-auth";
import { dbFind, dbInsert } from "@/lib/cc/agent-store";

export const dynamic = "force-dynamic";

// NOTE: this handler NEVER calls an LLM. No AI SDK is imported here by design
// (SPEC §1.3: tick runs time-based checks + tracking refresh only).

function chinaNow(): { hour: number; minute: number; weekday: number; iso: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const wd = get("weekday");
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  return { hour: Number(get("hour")), minute: Number(get("minute")), weekday, iso: new Date().toISOString() };
}

// POST /api/agent/tick — called every 15 min. Time checks + tracking refresh stubs.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const now = chinaNow();
  const checks: string[] = [];
  const queued: string[] = [];

  // Time check: overdue they_owe open items (stub: older than 24h) -> followup job.
  const items = await dbFind("openItems", (x) => !x.resolved_at);
  for (const item of items) {
    if (item.direction === "they_owe" && Date.now() - (item.opened_at || 0) > 24 * 3600 * 1000) {
      checks.push(`overdue:${item.id}`);
      await dbInsert("agentJobs", { type: "followup", status: "queued", payload: { open_item_id: item.id } });
      queued.push("followup");
    }
  }

  // Tracking refresh stub: touch in-transit shipments (real 17TRACK refresh is Goal 10).
  const shipments = await dbFind("shipments", (s) => s.status === "in_transit");
  for (const s of shipments) {
    checks.push(`tracking-refresh-stub:${s.id}:${s.tracking_number || "no-tracking"}`);
  }

  return NextResponse.json({ ok: true, chinaTime: now, checks, queued, llm_calls: 0 });
}
