import { describe, expect, it } from "vitest";

import { decideAction } from "@/lib/cc/drafter";
import { checkGuardrail } from "@/lib/cc/guardrail";

const C0 = {
  step1Done: true,
  step2Done: false,
  step3Done: false,
  step4Done: false,
  specAnswers: [] as string[],
  openChanges: 0,
  approach: "already_selling",
};

function draftsOf(r: ReturnType<typeof decideAction>): string[] {
  return r.draftBubbles || [];
}

describe("decideAction", () => {
  it("greeting -> none", () => {
    expect(decideAction({ text: "Hi" }, C0).action).toBe("none");
  });
  it("ok -> none", () => {
    expect(decideAction({ text: "ok" }, C0).action).toBe("none");
  });
  it("locked change -> polite decline draft", () => {
    const r = decideAction({ text: "We propose 70/30 blend instead." }, { ...C0, step2Done: true });
    expect(r.action).toBe("draft");
    expect(draftsOf(r).join(" ")).toMatch(/exactly to spec/i);
  });
  it("flexible change -> acceptance", () => {
    const r = decideAction({ text: "Can we use a different carton size?" }, { ...C0, step2Done: true });
    expect(r.action).toBe("draft");
    expect(draftsOf(r).join(" ")).toMatch(/works for us/i);
  });
  it("price quote -> number-free draft + record note", () => {
    const r = decideAction({ text: "Our price is $2.50 per unit." }, { ...C0, step2Done: true });
    expect(r.action).toBe("draft");
    expect(r.note).toBe("record-quote");
    expect(draftsOf(r).join(" ")).not.toMatch(/\d/);
  });
  it("sample fee -> fee", () => {
    expect(decideAction({ text: "Sample fee is $30." }, C0).action).toBe("fee");
  });
  it("pre-step-3 spec confirm -> question, not sample request", () => {
    const r = decideAction({ text: "Spec confirmed, we will follow it exactly." }, { ...C0, step2Done: true });
    expect(r.action).toBe("question");
  });
  it("post-step-3 spec confirm -> sample request draft", () => {
    const r = decideAction(
      { text: "Spec confirmed, we will follow it exactly." },
      { ...C0, step2Done: true, step3Done: true },
    );
    expect(r.action).toBe("draft");
    expect(draftsOf(r).join(" ")).toMatch(/义乌/);
  });
  it("opener attaches PDF", () => {
    const r = decideAction({ text: "We are a factory, tell me more." }, C0);
    expect(r.action).toBe("draft");
    expect(r.attachPdf).toBe(true);
  });
  it("tracking number -> thanks draft", () => {
    const r = decideAction({ text: "Shipped, SF1234567890123." }, { ...C0, step3Done: true, step4Done: true });
    expect(r.action).toBe("draft");
    expect(draftsOf(r).join(" ").toLowerCase()).toContain("confirm");
    expect(r.note ?? "").toMatch(/^tracking:/);
  });
  it("every draft passes the guardrail (sweep)", () => {
    const samples = [
      "We can make this product, please confirm?",
      "Thanks for sharing this.",
      "What is the price per unit?",
      "MOQ 500, deposit 30%?",
    ];
    for (const s of samples) {
      const r = decideAction({ text: s }, { ...C0, step2Done: true, step3Done: true });
      for (const b of draftsOf(r)) {
        expect(checkGuardrail(b).blocked, `blocked: ${b}`).toBe(false);
      }
    }
  });
});
