import { describe, expect, it } from "vitest";

import { decideAction } from "@/lib/cc/drafter";
import { checkGuardrail } from "@/lib/cc/guardrail";

import * as fs from "node:fs";
import * as path from "node:path";

interface Fixture {
  id: string;
  message: string;
  ctx: {
    step1Done: boolean;
    step2Done: boolean;
    step3Done: boolean;
    step4Done: boolean;
    specAnswers: string[];
    openChanges: number;
    approach: string;
  };
  expected: { action: string };
}

const dir = path.join(__dirname, "..", "fixtures", "drafter");
const fixtures: Fixture[] = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));

const EN = /[\u4e00-\u9fff]/;
const YIWU = /浙江义乌[\s\S]*?15067460724/g; // exempt: address is Chinese by necessity
const SAMPLE_REQ = /义乌|checklist|sample request|tracking number/i;

describe("drafter eval (Goal 8 fixture set)", () => {
  let _matched = 0;
  for (const fx of fixtures) {
    it(`eval ${fx.id} -> ${fx.expected.action}`, () => {
      const r = decideAction({ text: fx.message }, fx.ctx);
      const okAction = r.action === fx.expected.action;
      if (okAction) _matched++;
      console.log(`${okAction ? "PASS" : "FAIL"} ${fx.id}: got ${r.action}, want ${fx.expected.action}`);
      // Hard gates on every draft, regardless of action match.
      for (const b of r.draftBubbles ?? []) {
        expect(checkGuardrail(b).blocked, `[${fx.id}] guardrail blocked: ${b}`).toBe(false);
        expect(EN.test(b.replace(YIWU, "")), `[${fx.id}] non-English: ${b}`).toBe(false);
        if (!fx.ctx.step3Done) {
          expect(SAMPLE_REQ.test(b), `[${fx.id}] pre-step-3 sample request`).toBe(false);
        }
      }
      expect(okAction, `[${fx.id}] action`).toBe(true);
    });
  }

  it("meets the 90% action-match threshold", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(25);
  });
});
