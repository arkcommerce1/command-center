import { NextRequest, NextResponse } from "next/server";
import { agentAuth } from "@/lib/cc/agent-auth";
import { dbFind, dbInsert, dbUpdate, dbById } from "@/lib/cc/agent-store";
import { planFollowups } from "@/lib/cc/followups";

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

// POST /api/agent/tick — called every 15 min. Time checks + tracking refresh.
export async function POST(req: NextRequest) {
  const auth = agentAuth(req);
  if (auth) return auth;
  const now = chinaNow();
  const checks: string[] = [];
  const queued: string[] = [];

  // --- Follow-up time checks (SPEC §3.6, Goal 9) ---
  const allItems = await dbFind("openItems", (x) => !x.resolved_at);

  // Determine which factory_product_ids were active in the last 7 days:
  // a message linked to that factory_product_id in the last 7 days.
  const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const recentMessages = await dbFind("messages", (m) => Number(m.sent_at || 0) > sevenDaysAgo);
  const activeFps = new Set(recentMessages.map((m: any) => m.factory_product_id).filter(Boolean));

  // Which open items already have a queued cc-followups job?
  const existingJobs = await dbFind("agentJobs", (j) => j.type === "cc-followups" && j.status === "queued");
  const queuedItemIds = new Set(existingJobs.map((j: any) => j.payload?.openItemId).filter(Boolean));

  const snapshots = allItems.map((item: any) => ({
    id: item.id,
    factory_product_id: item.factory_product_id,
    direction: item.direction,
    kind: item.kind,
    opened_at: Number(item.opened_at || 0),
    followups_sent: Number(item.followups_sent || 0),
    last_followup_at: item.last_followup_at ? Number(item.last_followup_at) : null,
    resolved_at: item.resolved_at ? Number(item.resolved_at) : null,
  }));

  const plan = planFollowups(new Date(), snapshots, queuedItemIds, activeFps);

  // Queue cc-followups jobs for they_owe items.
  for (const job of plan.queueJobs) {
    checks.push(`followup-queue:${job.openItemId}:${job.importance}`);
    await dbInsert("agentJobs", {
      type: "cc-followups",
      status: "queued",
      payload: {
        factoryProductId: job.factoryProductId,
        openItemId: job.openItemId,
        importance: job.importance,
        sendAfter: job.sendAfter,
      },
    });
    queued.push("cc-followups");
  }

  // Raise we_owe question cards to High.
  for (const rq of plan.raiseQuestions) {
    checks.push(`we_owe-raise:${rq.openItemId}`);
    // Find the question linked to this open item and raise it to High.
    const questions = await dbFind("questions", (q: any) =>
      q.factory_product_id === rq.factoryProductId && q.status === "open",
    );
    for (const q of questions) {
      await dbUpdate("questions", q.id, { importance: "high" });
    }
  }

  // Archive after 2 unanswered follow-ups.
  for (const arch of plan.archiveRows) {
    checks.push(`archive:${arch.factoryProductId}:${arch.openItemId}`);
    // Set archived_at on the factory_product row (in the main store).
    // The Agent API agent-store doesn't have factoryProducts; log via
    // activity log in the agent-store and update the open item as resolved.
    const before = await dbById("openItems", arch.openItemId);
    if (before) {
      await dbUpdate("openItems", arch.openItemId, {
        resolved_at: Date.now(),
        resolution: "archived_2_unanswered",
      });
    }
    await dbInsert("activity", {
      actor: "agent",
      action: "archive.followup",
      entity: "open_items",
      entityId: arch.openItemId,
      before: before || null,
      after: { resolved: true, reason: "archived_2_unanswered" },
      undoable: true,
      undoneAt: null,
    });
  }

  // Notify Haim for all planned notifications.
  for (const n of plan.notifyHaim) {
    checks.push(`notify:${n.factoryProductId}`);
    await dbInsert("notifications", {
      contact_id: "",
      chat_id: "",
      text: n.text,
      attachments: [],
      status: "queued",
      sent_at: null,
    });
  }

  // Increment followups_sent for items we just queued a job for.
  for (const inc of plan.incrementFollowups) {
    const item = await dbById("openItems", inc.openItemId);
    if (item) {
      await dbUpdate("openItems", inc.openItemId, {
        followups_sent: Number(item.followups_sent || 0) + 1,
        last_followup_at: Date.now(),
      });
    }
  }

  // --- Tracking refresh stub: touch in-transit shipments (real 17TRACK refresh is Goal 10) ---
  const shipments = await dbFind("shipments", (s) => s.status === "in_transit");
  for (const s of shipments) {
    checks.push(`tracking-refresh-stub:${s.id}:${s.tracking_number || "no-tracking"}`);
  }

  return NextResponse.json({ ok: true, chinaTime: now, checks, queued, llm_calls: 0 });
}
