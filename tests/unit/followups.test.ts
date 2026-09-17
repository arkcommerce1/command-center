// Follow-up timing tests (SPEC §3.6, Goal 9).
import { describe, expect, it } from "vitest";

import { type OpenItemSnapshot, planFollowups } from "@/lib/cc/followups";

/** Build a China-time instant: cst(2026, 9, 18, 17) = Sep 18 2026, 5pm CST. */
function cst(y: number, m: number, d: number, h: number, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 8, min));
}

function makeItem(overrides: Partial<OpenItemSnapshot> & { id: string; factory_product_id: string }): OpenItemSnapshot {
  return {
    direction: "they_owe",
    kind: "question",
    opened_at: 0,
    followups_sent: 0,
    last_followup_at: null,
    resolved_at: null,
    ...overrides,
  };
}

describe("follow-up timing (SPEC §3.6)", () => {
  it("weekend skip: a they_owe item opened Friday 5pm is not due Saturday", () => {
    const opened = cst(2026, 9, 18, 17); // Friday 5pm CST
    const sat = cst(2026, 9, 19, 12); // Saturday noon CST
    const item = makeItem({
      id: "item-1",
      factory_product_id: "fp-1",
      opened_at: opened.getTime(),
    });
    const plan = planFollowups(sat, [item], new Set(), new Set());
    // Saturday: not a business day, so isDue returns false → no actions.
    expect(plan.queueJobs).toHaveLength(0);
    expect(plan.archiveRows).toHaveLength(0);
  });

  it("Golden Week skip: an item opened Sep 30 is not due until Oct 8", () => {
    const opened = cst(2026, 9, 30, 10); // Wednesday before Golden Week
    const oct5 = cst(2026, 10, 5, 12); // Mid Golden Week
    const item = makeItem({
      id: "item-2",
      factory_product_id: "fp-2",
      opened_at: opened.getTime(),
    });
    const plan = planFollowups(oct5, [item], new Set(), new Set());
    expect(plan.queueJobs).toHaveLength(0);
    expect(plan.archiveRows).toHaveLength(0);
  });

  it("Golden Week skip: the same item IS due on Oct 8 (business day)", () => {
    const opened = cst(2026, 9, 30, 10); // Wednesday 10am
    const oct8 = cst(2026, 10, 8, 10); // Thursday after Golden Week
    const item = makeItem({
      id: "item-2b",
      factory_product_id: "fp-2b",
      opened_at: opened.getTime(),
    });
    const plan = planFollowups(oct8, [item], new Set(), new Set());
    expect(plan.queueJobs).toHaveLength(1);
    expect(plan.queueJobs[0].openItemId).toBe("item-2b");
  });

  it("Friday 5pm + 24 business hours → due Monday 5pm", () => {
    const opened = cst(2026, 9, 18, 17); // Friday 5pm CST
    const mon5pm = cst(2026, 9, 21, 17); // Monday 5pm CST
    const mon9am = cst(2026, 9, 21, 9); // Monday 9am CST
    const item = makeItem({
      id: "item-3",
      factory_product_id: "fp-3",
      opened_at: opened.getTime(),
    });

    // Monday 9am: not yet due (Friday 5pm + 24h = Monday 5pm).
    const planEarly = planFollowups(mon9am, [item], new Set(), new Set());
    expect(planEarly.queueJobs).toHaveLength(0);

    // Monday 5pm: due.
    const planDue = planFollowups(mon5pm, [item], new Set(), new Set());
    expect(planDue.queueJobs).toHaveLength(1);
    expect(planDue.queueJobs[0].openItemId).toBe("item-3");
  });

  it("2nd unanswered follow-up archives the row (no third job queued)", () => {
    const opened = cst(2026, 9, 14, 10); // Monday 10am
    const now = cst(2026, 9, 18, 10); // Friday 10am (well past 2× 24h)
    const item = makeItem({
      id: "item-4",
      factory_product_id: "fp-4",
      opened_at: opened.getTime(),
      followups_sent: 2, // already sent 2 follow-ups
      last_followup_at: cst(2026, 9, 17, 10).getTime(),
    });
    const plan = planFollowups(now, [item], new Set(), new Set());
    // followups_sent >= 2 → archive, not a third job.
    expect(plan.queueJobs).toHaveLength(0);
    expect(plan.archiveRows).toHaveLength(1);
    expect(plan.archiveRows[0].factoryProductId).toBe("fp-4");
    expect(plan.archiveRows[0].openItemId).toBe("item-4");
    expect(plan.notifyHaim).toHaveLength(1);
    expect(plan.notifyHaim[0].text).toContain("Archived");
  });

  it("we_owe raises to High with no factory draft", () => {
    const opened = cst(2026, 9, 14, 10); // Monday 10am
    const now = cst(2026, 9, 16, 10); // Wednesday 10am (24+ business hours later)
    const item = makeItem({
      id: "item-5",
      factory_product_id: "fp-5",
      direction: "we_owe",
      kind: "question",
      opened_at: opened.getTime(),
    });
    const plan = planFollowups(now, [item], new Set(), new Set());
    // we_owe: raise question, notify Haim, NO factory draft (no queueJobs).
    expect(plan.queueJobs).toHaveLength(0);
    expect(plan.raiseQuestions).toHaveLength(1);
    expect(plan.raiseQuestions[0].openItemId).toBe("item-5");
    expect(plan.notifyHaim).toHaveLength(1);
    expect(plan.notifyHaim[0].text).toContain("waiting on you");
  });

  it("importance: High when kind is sample_tracking (blocks a sample)", () => {
    const opened = cst(2026, 9, 14, 10); // Monday 10am
    // sample_tracking: 72 business hours = 3 business days. Mon 10am + 72h
    // = Thu 10am. So check on Thursday 10am.
    const thu = cst(2026, 9, 17, 10); // Thursday 10am
    const item = makeItem({
      id: "item-6",
      factory_product_id: "fp-6",
      kind: "sample_tracking",
      opened_at: opened.getTime(),
    });
    const plan = planFollowups(thu, [item], new Set(), new Set());
    expect(plan.queueJobs).toHaveLength(1);
    expect(plan.queueJobs[0].importance).toBe("High");
  });

  it("importance: Medium when factory active in last 7 days", () => {
    const opened = cst(2026, 9, 14, 10); // Monday 10am
    const now = cst(2026, 9, 16, 10); // Wednesday 10am
    const item = makeItem({
      id: "item-7",
      factory_product_id: "fp-7",
      kind: "question",
      opened_at: opened.getTime(),
    });
    const plan = planFollowups(now, [item], new Set(), new Set(["fp-7"]));
    expect(plan.queueJobs).toHaveLength(1);
    expect(plan.queueJobs[0].importance).toBe("Medium");
  });

  it("importance: Low when factory not active in last 7 days", () => {
    const opened = cst(2026, 9, 14, 10); // Monday 10am
    const now = cst(2026, 9, 16, 10); // Wednesday 10am
    const item = makeItem({
      id: "item-8",
      factory_product_id: "fp-8",
      kind: "question",
      opened_at: opened.getTime(),
    });
    const plan = planFollowups(now, [item], new Set(), new Set());
    expect(plan.queueJobs).toHaveLength(1);
    expect(plan.queueJobs[0].importance).toBe("Low");
  });

  it("sendAfter is set to next 9:30 when outside business hours", () => {
    const opened = cst(2026, 9, 14, 10); // Monday 10am
    // Saturday 2pm: outside business time, next slot is Monday 9:30.
    const sat = cst(2026, 9, 19, 14);
    const item = makeItem({
      id: "item-9",
      factory_product_id: "fp-9",
      // Use a due date that crosses into Saturday: opened Tuesday 2pm,
      // 24 business hours later = Wednesday 2pm. But we want it due on
      // Saturday — so use sample_tracking (72h) opened Wednesday.
      kind: "question",
      opened_at: opened.getTime(),
    });
    // Actually, the item needs to be overdue as of Saturday. opened Monday
    // 10am + 24h = Tuesday 10am. Saturday is well past that.
    const plan = planFollowups(sat, [item], new Set(), new Set());
    // It should be due and sendAfter should be Monday 9:30.
    expect(plan.queueJobs).toHaveLength(1);
    const expectedSlot = cst(2026, 9, 21, 9, 30).getTime();
    expect(plan.queueJobs[0].sendAfter).toBe(expectedSlot);
  });

  it("sendAfter is now when inside business hours", () => {
    const opened = cst(2026, 9, 14, 10); // Monday 10am
    const wed10am = cst(2026, 9, 16, 10); // Wednesday 10am (business time)
    const item = makeItem({
      id: "item-10",
      factory_product_id: "fp-10",
      opened_at: opened.getTime(),
    });
    const plan = planFollowups(wed10am, [item], new Set(), new Set());
    expect(plan.queueJobs).toHaveLength(1);
    expect(plan.queueJobs[0].sendAfter).toBe(wed10am.getTime());
  });

  it("skips items already queued (no duplicate jobs)", () => {
    const opened = cst(2026, 9, 14, 10); // Monday 10am
    const now = cst(2026, 9, 16, 10); // Wednesday 10am
    const item = makeItem({
      id: "item-11",
      factory_product_id: "fp-11",
      opened_at: opened.getTime(),
    });
    const plan = planFollowups(now, [item], new Set(["item-11"]), new Set());
    expect(plan.queueJobs).toHaveLength(0);
  });

  it("skips resolved items", () => {
    const opened = cst(2026, 9, 14, 10); // Monday 10am
    const now = cst(2026, 9, 16, 10); // Wednesday 10am
    const item = makeItem({
      id: "item-12",
      factory_product_id: "fp-12",
      opened_at: opened.getTime(),
      resolved_at: now.getTime() - 1000,
    });
    const plan = planFollowups(now, [item], new Set(), new Set());
    expect(plan.queueJobs).toHaveLength(0);
    expect(plan.archiveRows).toHaveLength(0);
    expect(plan.raiseQuestions).toHaveLength(0);
  });

  it("1st follow-up queues a job (followups_sent=0 → 1 after increment)", () => {
    const opened = cst(2026, 9, 14, 10); // Monday 10am
    const now = cst(2026, 9, 16, 10); // Wednesday 10am
    const item = makeItem({
      id: "item-13",
      factory_product_id: "fp-13",
      opened_at: opened.getTime(),
      followups_sent: 0,
    });
    const plan = planFollowups(now, [item], new Set(), new Set());
    expect(plan.queueJobs).toHaveLength(1);
    expect(plan.archiveRows).toHaveLength(0);
    expect(plan.incrementFollowups).toHaveLength(1);
  });

  it("2nd follow-up (followups_sent=1) queues a job, not archive", () => {
    const opened = cst(2026, 9, 14, 10); // Monday 10am
    const now = cst(2026, 9, 16, 10); // Wednesday 10am
    const item = makeItem({
      id: "item-14",
      factory_product_id: "fp-14",
      opened_at: opened.getTime(),
      followups_sent: 1,
      last_followup_at: cst(2026, 9, 15, 10).getTime(),
    });
    const plan = planFollowups(now, [item], new Set(), new Set());
    expect(plan.queueJobs).toHaveLength(1);
    expect(plan.archiveRows).toHaveLength(0);
  });
});
