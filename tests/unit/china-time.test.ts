// China business-time tests (SPEC §3.6): weekend, Golden Week, Friday->Monday.
import { describe, expect, it } from "vitest";

import { addBusinessHours, isBusinessDay, isBusinessTime, isDue, nextBusinessSlot } from "@/lib/cc/china-time";

/** Build a China-time instant: cst(2026, 9, 18, 17) = Sep 18 2026, 5pm CST. */
function cst(y: number, m: number, d: number, h: number, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 8, min));
}

describe("china business time", () => {
  it("treats a Wednesday 10am as business time", () => {
    expect(isBusinessTime(cst(2026, 9, 30, 10))).toBe(true);
    expect(isBusinessDay(cst(2026, 9, 30, 10))).toBe(true);
  });

  it("is closed outside the 9:30–18:00 window", () => {
    expect(isBusinessTime(cst(2026, 9, 30, 8))).toBe(false);
    expect(isBusinessTime(cst(2026, 9, 30, 19))).toBe(false);
    expect(isBusinessTime(cst(2026, 9, 30, 9, 29))).toBe(false);
    expect(isBusinessTime(cst(2026, 9, 30, 9, 30))).toBe(true);
  });

  it("skips the weekend: Saturday noon -> Monday 9:30", () => {
    const sat = cst(2026, 9, 19, 12); // Saturday
    expect(isBusinessDay(sat)).toBe(false);
    expect(isBusinessTime(sat)).toBe(false);
    const slot = nextBusinessSlot(sat);
    expect(slot.getTime()).toBe(cst(2026, 9, 21, 9, 30).getTime());
  });

  it("skips Golden Week Oct 1–7 2026", () => {
    for (let d = 1; d <= 7; d++) {
      expect(isBusinessDay(cst(2026, 10, d, 10))).toBe(false);
    }
    // Sep 30 is a business day, Oct 8 is one again.
    expect(isBusinessDay(cst(2026, 9, 30, 10))).toBe(true);
    expect(isBusinessDay(cst(2026, 10, 8, 10))).toBe(true);
    // A slot requested mid-Golden-Week lands on Oct 8 9:30.
    const slot = nextBusinessSlot(cst(2026, 10, 3, 12));
    expect(slot.getTime()).toBe(cst(2026, 10, 8, 9, 30).getTime());
  });

  it("Friday 5pm + 24 business hours becomes due Monday 5pm", () => {
    const opened = cst(2026, 9, 18, 17); // Friday 5pm CST
    const due = addBusinessHours(opened, 24);
    expect(due.getTime()).toBe(cst(2026, 9, 21, 17).getTime());
    expect(isDue(opened, 24, cst(2026, 9, 21, 9))).toBe(false);
    expect(isDue(opened, 24, cst(2026, 9, 21, 17))).toBe(true);
  });

  it("nothing becomes due during Golden Week", () => {
    const opened = cst(2026, 9, 30, 10); // Wednesday before Golden Week
    const due = addBusinessHours(opened, 24);
    expect(due.getTime()).toBe(cst(2026, 10, 8, 10).getTime());
    expect(isDue(opened, 24, cst(2026, 10, 5, 12))).toBe(false);
    expect(isDue(opened, 24, cst(2026, 10, 8, 10))).toBe(true);
  });

  it("sample tracking: 72 business-day hours skips the weekend when it lands there", () => {
    // Friday 10am + 72h wall-clock = Monday 10am (business day: no push).
    const fri = cst(2026, 9, 18, 10);
    expect(addBusinessHours(fri, 3 * 24).getTime()).toBe(cst(2026, 9, 21, 10).getTime());
    // Wednesday 10am + 72h = Saturday -> pushed to Monday 10am.
    const wed = cst(2026, 9, 16, 10);
    expect(addBusinessHours(wed, 3 * 24).getTime()).toBe(cst(2026, 9, 21, 10).getTime());
    expect(isDue(wed, 3 * 24, cst(2026, 9, 20, 12))).toBe(false);
    expect(isDue(wed, 3 * 24, cst(2026, 9, 21, 10))).toBe(true);
  });

  it("nextBusinessSlot returns the input when already in business time", () => {
    const wed = cst(2026, 9, 30, 10);
    expect(nextBusinessSlot(wed).getTime()).toBe(wed.getTime());
  });
});
