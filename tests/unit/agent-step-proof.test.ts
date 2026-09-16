import { describe, expect, it } from "vitest";

import { validateStepProof } from "@/lib/cc/step-proof";

describe("validateStepProof (SPEC §3.3 + §1.3)", () => {
  it.each([
    ["ok", "ok"],
    ["okay", "okay"],
    ["noted", "Noted."],
    ["received", "received"],
    ["thanks", "Thanks!"],
    ["got it", "Got it"],
    ["please wait", "Please wait"],
    ["one moment", "one moment"],
    ["thumbs-up emoji", "👍"],
    ["single emoji", "🙏"],
    ["chinese ok", "好的"],
    ["chinese received", "收到"],
    ["chinese wait", "稍等"],
  ])("rejects ack-only proof: %s", (_label, text) => {
    expect(validateStepProof({ direction: "in", senderType: "factory", text })).toEqual({
      ok: false,
      reason: expect.stringContaining("acknowledg"),
    });
  });

  it("rejects outbound messages as proof", () => {
    expect(
      validateStepProof({ direction: "out", senderType: "factory", text: "Yes, we confirm the spec." }),
    ).toEqual({ ok: false, reason: expect.stringContaining("inbound") });
  });

  it("rejects proofs from non-factory contacts", () => {
    expect(
      validateStepProof({ direction: "in", senderType: "ours", text: "Yes, we confirm the spec." }),
    ).toEqual({ ok: false, reason: expect.stringContaining("factory contact") });
  });

  it.each([
    ["spec confirm", "Yes, we confirm the material is 80% cotton as specified."],
    ["can-make-it", "We can make this product with your logo."],
    ["tracking", "Sample shipped, tracking number SF123456789."],
  ])("accepts substantive factory proof: %s", (_label, text) => {
    expect(validateStepProof({ direction: "in", senderType: "factory", text })).toEqual({ ok: true });
  });
});
