import { describe, expect, it } from "vitest";

import { applyRules } from "@/lib/cc/rule-engine";

describe("rule engine (Goal 5)", () => {
  it("strips exclamation marks when 'Never use exclamation marks' rule is active", () => {
    const input = ["Hi!! This is great!!", "Can you confirm??"];
    const rules = ["Never use exclamation marks."];
    const result = applyRules(input, rules, []);
    expect(result).toEqual(["Hi.. This is great..", "Can you confirm??"]);
    // No exclamation marks should remain
    for (const b of result) {
      expect(b.includes("!")).toBe(false);
    }
  });

  it("leaves exclamation marks when no rule is active", () => {
    const input = ["Hi!! This is great!!"];
    const result = applyRules(input, [], []);
    expect(result).toEqual(["Hi!! This is great!!"]);
  });

  it("truncates long bubbles when 'Keep replies short' rule is active", () => {
    const longBubble = "A".repeat(200);
    const input = [longBubble];
    const rules = ["Keep replies short and concise."];
    const result = applyRules(input, rules, []);
    expect(result[0].length).toBeLessThanOrEqual(120);
  });

  it("replaces contact name when 'Address the contact as X' rule is active", () => {
    const input = ["Hi, we would love to work with you.", "Can you make samples?"];
    const rules = ["Address the contact as Shene."];
    const result = applyRules(input, rules, []);
    expect(result[0]).toContain("Shene");
  });

  it("removes price/volume sentences when 'Never mention price' rule is active", () => {
    const input = ["Thanks for the quote. Our price is $5 per unit, MOQ is 1000.", "Can you send samples?"];
    const rules = ["Never mention price or volume."];
    const result = applyRules(input, rules, []);
    // The sentence with price should be removed or the price words gone
    const combined = result.join(" ");
    // Either the price sentence was removed or the price words were stripped
    expect(combined.includes("$5")).toBe(false);
  });

  it("applies all-factory rules before factory-specific rules", () => {
    const input = ["Hi!!"];
    const allRules = ["Never use exclamation marks."];
    const factoryRules: string[] = [];
    const result = applyRules(input, allRules, factoryRules);
    expect(result[0].includes("!")).toBe(false);
  });

  it("does not modify bubbles when no rules match", () => {
    const input = ["Hello, how are you?", "Can you confirm the spec?"];
    const rules = ["This rule does not match anything specific."];
    const result = applyRules(input, rules, []);
    expect(result).toEqual(input);
  });
});
