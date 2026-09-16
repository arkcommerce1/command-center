import { describe, expect, it } from "vitest";

import { checkGuardrail } from "@/lib/cc/guardrail";

describe("checkGuardrail", () => {
  it.each([
    ["price in dollars", "We can offer $120 per unit.", "Currency amount or price mentioned"],
    ["USD code", "The quote is 5 USD per piece.", "Currency amount or price mentioned"],
    ["MOQ language", "Our MOQ is 500 pieces.", "Minimum order / MOQ language"],
    ["payment terms", "We require a 30% deposit before production.", "Payment terms language"],
    ["T/T terms", "Payment by T/T in advance.", "Payment terms language"],
    ["discount phrasing", "We can give you a 10% discount.", "Discount or counteroffer phrasing"],
    ["best price phrasing", "Please tell us your best price.", "Discount or counteroffer phrasing"],
  ])("blocks %s", (_label, text, reason) => {
    expect(checkGuardrail(text)).toEqual({ blocked: true, reason });
  });

  it.each([
    ["plain greeting", "Hello, thanks for your message."],
    ["brand mention", "We already import and sell AllSett Health products."],
    ["sample request", "Could you send a sample to our Yiwu office?"],
    ["spec talk without numbers", "Please confirm the material and color."],
  ])("allows %s", (_label, text) => {
    expect(checkGuardrail(text)).toEqual({ blocked: false, reason: null });
  });

  it("handles empty input without blocking", () => {
    expect(checkGuardrail("")).toEqual({ blocked: false, reason: null });
  });
});
