import { describe, expect, it } from "vitest";

import {
  composeWhereWeStand,
  formatSince,
  hoursSince,
  sinceColorClass,
  sortBoardRows,
  waitingRank,
} from "@/lib/cc/factory-board";

describe("waitingRank", () => {
  it("orders haim before factory before the rest", () => {
    expect(waitingRank("haim")).toBeLessThan(waitingRank("factory"));
    expect(waitingRank("factory")).toBeLessThan(waitingRank("yuki"));
    expect(waitingRank("yuki")).toBeLessThan(waitingRank("none"));
    expect(waitingRank(null)).toBe(3);
  });
});

describe("sortBoardRows", () => {
  it("sorts Haim-waiting first, then longest-waiting", () => {
    const rows = [
      { waitingOn: "factory" as const, since: 100 },
      { waitingOn: "haim" as const, since: 300 },
      { waitingOn: "haim" as const, since: 200 },
      { waitingOn: null, since: 50 },
    ];
    const sorted = sortBoardRows(rows);
    expect(sorted.map((r) => r.since)).toEqual([200, 300, 100, 50]);
  });
});

describe("since helpers", () => {
  it("formats minutes, hours, days", () => {
    expect(formatSince(null)).toBe("—");
    expect(formatSince(0.1)).toBe("6m");
    expect(formatSince(7)).toBe("7h");
    expect(formatSince(49)).toBe("2d");
  });
  it("colors past 24h amber and past 48h red", () => {
    expect(sinceColorClass(5)).toContain("muted");
    expect(sinceColorClass(30)).toContain("amber");
    expect(sinceColorClass(60)).toContain("red");
  });
  it("hoursSince returns null for unknown", () => {
    expect(hoursSince(null)).toBeNull();
    expect(hoursSince(Number.NaN)).toBeNull();
  });
});

describe("composeWhereWeStand", () => {
  it("composes one paragraph from status fields", () => {
    const s = composeWhereWeStand({
      factoryName: "F",
      productName: "P",
      doneSteps: 2,
      statusSentence: "Sample agreed.",
      waitingOn: "factory",
      sinceText: "3h",
      nextStep: "Chase tracking.",
      openItems: 1,
    });
    expect(s).toContain("2 of 5 steps done");
    expect(s).toContain("Sample agreed.");
    expect(s).toContain("Waiting on factory (3h).");
    expect(s).toContain("Next: Chase tracking.");
    expect(s).toContain("1 open item.");
  });
});
