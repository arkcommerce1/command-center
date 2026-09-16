// Guardrail unit tests (SPEC §3.4): every pattern plus every exception.
import { describe, expect, it } from "vitest";

import { checkGuardrail } from "@/lib/cc/guardrail";

describe("checkGuardrail §3.4", () => {
  it.each([
    ["dollar sign", "We can offer $120 per unit."],
    ["US dollars", "US$5 per piece."],
    ["USD code after", "The quote is 5 USD per piece."],
    ["USD code before", "USD 5 per unit."],
    ["yuan symbol", "¥500 including freight."],
    ["RMB", "500 RMB per carton."],
    ["CNY", "CNY 500 per order."],
    ["yuan word", "500 yuan per box."],
    ["dollar word", "5 dollars each."],
    ["euro", "€5 per item."],
  ])("blocks currency: %s", (_label, text) => {
    expect(checkGuardrail(text).blocked).toBe(true);
    expect(checkGuardrail(text).reason).toBe("Currency amount");
  });

  it.each([
    ["price", "Please tell us your price."],
    ["pricing", "Send your pricing list."],
    ["cost", "What is the cost?"],
    ["cheaper", "Can you go cheaper?"],
    ["discount", "We can give a 10% discount."],
    ["counter", "We need a counter to that."],
    ["counteroffer", "Here is our counteroffer."],
    ["target price", "Our target price is low."],
    ["budget", "That is over our budget."],
    ["per unit", "Quote per unit please."],
    ["per piece", "Quote per piece please."],
    ["/pc", "Quote 5/pc please."],
    ["/pcs", "Quote 5/pcs please."],
    ["unit price", "What is the unit price?"],
    ["EXW", "Quote EXW please."],
    ["FOB", "Quote FOB Shanghai."],
    ["CIF", "Quote CIF New York."],
    ["DDP", "Quote DDP please."],
    ["lowercase incoterm", "quote fob shanghai"],
  ])("blocks pricing: %s", (_label, text) => {
    expect(checkGuardrail(text).blocked).toBe(true);
    expect(checkGuardrail(text).reason).toBe("Pricing language");
  });

  it.each([
    ["MOQ", "Our MOQ is 500 pieces."],
    ["minimum order", "What is the minimum order?"],
    ["order quantity", "Confirm the order quantity."],
    ["bulk order", "We plan a bulk order."],
    ["first order", "For the first order we need speed."],
    ["trial order", "Start with a trial order."],
    ["container", "How many boxes fit a container?"],
    ["20GP", "Fits in a 20GP."],
    ["40HQ", "Fits in a 40HQ."],
  ])("blocks orders: %s", (_label, text) => {
    expect(checkGuardrail(text).blocked).toBe(true);
    expect(checkGuardrail(text).reason).toBe("Order language");
  });

  it.each([
    ["payment terms", "What are your payment terms?"],
    ["deposit", "We require a 30% deposit."],
    ["T/T", "Payment by T/T in advance."],
    ["TT payment", "TT payment within 7 days."],
    ["balance payment", "Balance payment before shipment."],
    ["L/C", "We can open an L/C."],
    ["wire transfer", "Pay by wire transfer."],
    ["invoice", "Please send the invoice."],
    ["PayPal", "Pay via PayPal."],
    ["Alipay", "Pay via Alipay."],
  ])("blocks payment: %s", (_label, text) => {
    expect(checkGuardrail(text).blocked).toBe(true);
    expect(checkGuardrail(text).reason).toBe("Payment language");
  });

  it.each([
    ["per month", "We sell 5000 per month."],
    ["monthly", "Our monthly volume is big."],
    ["per year", "We move 1M units per year."],
    ["annually", "We import annually."],
    ["kg/month", "We need 200 kg/month."],
    ["pcs/month", "We need 5000 pcs/month."],
    ["units/month", "We sell 9000 units/month."],
    ["tons", "We ship 2 tons weekly."],
  ])("blocks volume when can_share_volumes is false: %s", (_label, text) => {
    expect(checkGuardrail(text).blocked).toBe(true);
    expect(checkGuardrail(text).reason).toBe("Volume language");
  });

  it.each([
    ["per month", "We sell 5000 per month."],
    ["monthly", "Our monthly volume is big."],
    ["tons", "We ship 2 tons weekly."],
  ])("allows volume when can_share_volumes is true: %s", (_label, text) => {
    expect(checkGuardrail(text, { canShareVolumes: true })).toEqual({ blocked: false, reason: null });
  });

  it("still blocks negotiation when volumes are shareable", () => {
    expect(checkGuardrail("Our price is $5.", { canShareVolumes: true }).blocked).toBe(true);
    expect(checkGuardrail("What is the MOQ?", { canShareVolumes: true }).blocked).toBe(true);
  });

  describe("allowed exceptions (must NOT block)", () => {
    it("allows numbers appearing in the approved spec", () => {
      expect(
        checkGuardrail("Dimensions 10 x 8 x 6 cm, 75% recycled cotton, 4-ply yarn.", {
          specNumbers: [10, 8, 6, 75, 4],
        }),
      ).toEqual({ blocked: false, reason: null });
    });

    it("allows dates", () => {
      expect(checkGuardrail("Please reply by 2026-10-08.")).toEqual({ blocked: false, reason: null });
      expect(checkGuardrail("Let's talk on Oct 8.")).toEqual({ blocked: false, reason: null });
      expect(checkGuardrail("Ship on 10/08/2026.")).toEqual({ blocked: false, reason: null });
    });

    it("allows tracking numbers", () => {
      expect(checkGuardrail("Tracking number SF1234567890, thanks!")).toEqual({
        blocked: false,
        reason: null,
      });
    });

    it("allows the Yiwu address and its phone number", () => {
      expect(
        checkGuardrail("Please send the sample to 浙江义乌稠城街道丹溪北路18号雪峰银座9楼912室 丁小姐 15067460724."),
      ).toEqual({ blocked: false, reason: null });
    });

    it("allows phone numbers", () => {
      expect(checkGuardrail("You can reach us at +86 138 0000 0000.")).toEqual({
        blocked: false,
        reason: null,
      });
    });

    it("allows the exact fee card message even though it names a price", () => {
      const fee = "Sample fee is $20, please pay via wire transfer.";
      expect(checkGuardrail(fee)).toEqual({ blocked: true, reason: "Currency amount" });
      expect(checkGuardrail(fee, { feeMessage: fee })).toEqual({ blocked: false, reason: null });
    });

    it("allows brand mentions and plain spec/sample talk", () => {
      expect(checkGuardrail("We already import and sell AllSett Health products.")).toEqual({
        blocked: false,
        reason: null,
      });
      expect(checkGuardrail("Please confirm the material and color.")).toEqual({
        blocked: false,
        reason: null,
      });
      expect(checkGuardrail("Could you send a sample to our Yiwu office?")).toEqual({
        blocked: false,
        reason: null,
      });
    });

    it("does not mistake ordinary words for blocked terms", () => {
      expect(checkGuardrail("We encountered no issues.")).toEqual({ blocked: false, reason: null });
      expect(checkGuardrail("The shipment contains accessories.")).toEqual({ blocked: false, reason: null });
    });

    it("handles empty input without blocking", () => {
      expect(checkGuardrail("")).toEqual({ blocked: false, reason: null });
    });
  });
});
