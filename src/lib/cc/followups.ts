// Follow-up timing logic (SPEC §3.6, Goal 9).
// Pure planner: given the current time and open-item snapshots, returns
// what the tick route should do. No I/O — fully unit-testable.
import { isDue, isBusinessTime, nextBusinessSlot } from "@/lib/cc/china-time";

/** Due hours per open-item kind (SPEC §3.6). */
export const FOLLOWUP_DUE_HOURS: Record<string, number> = {
  question: 24, // 24 business-day hours
  sample_tracking: 72, // 3 business days (3 × 24)
};

export type FollowupImportance = "High" | "Medium" | "Low";

export interface OpenItemSnapshot {
  id: string;
  factory_product_id: string;
  direction: "we_owe" | "they_owe";
  kind: "question" | "sample_tracking";
  opened_at: number;
  followups_sent: number;
  last_followup_at: number | null;
  resolved_at: number | null;
}

export interface FollowupPlan {
  queueJobs: Array<{
    openItemId: string;
    factoryProductId: string;
    direction: "they_owe";
    importance: FollowupImportance;
    sendAfter: number;
  }>;
  archiveRows: Array<{
    factoryProductId: string;
    openItemId: string;
  }>;
  raiseQuestions: Array<{
    openItemId: string;
    factoryProductId: string;
  }>;
  notifyHaim: Array<{
    text: string;
    factoryProductId: string;
  }>;
  incrementFollowups: Array<{
    openItemId: string;
  }>;
}

/**
 * Pure planner: given `now`, open-item snapshots, the set of open-item IDs
 * that already have a queued cc-followups job, and the set of
 * factory_product_ids active in the last 7 days, returns the actions the
 * tick route should execute.
 *
 * - A they_owe item overdue (per §3.6 due hours) with < 2 follow-ups sent
 *   → queue a cc-followups job (importance per spec: High if it blocks a
 *   sample i.e. kind === sample_tracking, Medium if the factory was active
 *   in the last 7 days, Low otherwise). The sendAfter is `now` when inside
 *   the 9:30–18:00 CST window, else the next 9:30 CST business slot.
 * - A they_owe item overdue with ≥ 2 follow-ups sent → archive the row
 *   (the tick route sets archived_at, logs with Undo, notifies Haim).
 * - A we_owe item overdue → raise the question card to High, notify Haim.
 *   No factory draft.
 *
 * The due clock uses `last_followup_at` when followups_sent > 0 (so
 * follow-ups are spaced 24 business hours apart), else `opened_at`.
 */
export function planFollowups(
  now: Date,
  items: OpenItemSnapshot[],
  alreadyQueuedItemIds: Set<string>,
  activeFactoryProducts: Set<string>,
): FollowupPlan {
  const plan: FollowupPlan = {
    queueJobs: [],
    archiveRows: [],
    raiseQuestions: [],
    notifyHaim: [],
    incrementFollowups: [],
  };

  for (const item of items) {
    if (item.resolved_at) continue;
    if (alreadyQueuedItemIds.has(item.id)) continue;

    const dueHours = FOLLOWUP_DUE_HOURS[item.kind] ?? 24;
    // Use last_followup_at for subsequent due checks, opened_at for the
    // first follow-up, so follow-ups are spaced 24 business hours apart.
    const dueBase =
      item.followups_sent > 0 && item.last_followup_at
        ? item.last_followup_at
        : item.opened_at;

    if (!isDue(new Date(dueBase), dueHours, now)) continue;

    if (item.direction === "they_owe") {
      if (item.followups_sent >= 2) {
        // Archive the factory_product row (Undo + notify handled by caller).
        plan.archiveRows.push({
          factoryProductId: item.factory_product_id,
          openItemId: item.id,
        });
        plan.notifyHaim.push({
          text: `Archived factory+product ${item.factory_product_id} after 2 unanswered follow-ups (open item ${item.id}). Undo on the dashboard if premature.`,
          factoryProductId: item.factory_product_id,
        });
      } else {
        // Queue a cc-followups job.
        const importance: FollowupImportance =
          item.kind === "sample_tracking"
            ? "High"
            : activeFactoryProducts.has(item.factory_product_id)
              ? "Medium"
              : "Low";

        const sendAfter = isBusinessTime(now)
          ? now.getTime()
          : nextBusinessSlot(now).getTime();

        plan.queueJobs.push({
          openItemId: item.id,
          factoryProductId: item.factory_product_id,
          direction: "they_owe",
          importance,
          sendAfter,
        });
        plan.incrementFollowups.push({ openItemId: item.id });
      }
    } else if (item.direction === "we_owe") {
      // Raise the question card to High and notify Haim. No factory draft.
      plan.raiseQuestions.push({
        openItemId: item.id,
        factoryProductId: item.factory_product_id,
      });
      plan.notifyHaim.push({
        text: `A factory question has been waiting on you for 24+ business hours (factory+product ${item.factory_product_id}, open item ${item.id}). Please answer on the dashboard.`,
        factoryProductId: item.factory_product_id,
      });
    }
  }

  return plan;
}
