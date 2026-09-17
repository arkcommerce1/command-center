import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { dbFind } from "@/lib/cc/agent-store";
import { getDraftContext } from "@/lib/cc/learning";
import { applyRules } from "@/lib/cc/rule-engine";
import { incrementRuleUsage } from "@/lib/cc/learning";

// GET /api/agent/draft-context?factoryProductId=...&factoryName=...
// Returns the learned rules and past examples for the plugin to use
// when creating a draft. The plugin applies these to the deterministic
// bubbles before saving the draft.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const factoryProductId = url.searchParams.get("factoryProductId") || null;
  const factoryName = url.searchParams.get("factoryName") || null;

  const ctx = await getDraftContext(factoryProductId, factoryName, 5);

  return NextResponse.json({
    allRules: ctx.rules.all.map((r: any) => r.ruleText),
    factoryRules: ctx.rules.factory.map((r: any) => r.ruleText),
    ruleIds: ctx.ruleIds,
    examples: ctx.examples.map((e: any) => ({
      incoming: e.incomingMessage,
      reply: e.finalText,
      factoryProductId: e.factoryProductId,
      action: e.action,
    })),
  });
}

// POST /api/agent/draft-context/apply
// Body: { bubbles: string[], factoryProductId?: string, factoryName?: string }
// Returns the bubbles with all applicable rules applied.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}) as any);
  const bubbles: string[] = Array.isArray(b?.bubbles) ? b.bubbles : [];
  const factoryProductId = b?.factoryProductId || null;
  const factoryName = b?.factoryName || null;

  const ctx = await getDraftContext(factoryProductId, factoryName, 5);
  const applied = applyRules(bubbles, ctx.rules.all.map((r: any) => r.ruleText), ctx.rules.factory.map((r: any) => r.ruleText));

  // Increment usage counts on the rules that were applied.
  if (ctx.ruleIds.length > 0) {
    incrementRuleUsage(ctx.ruleIds).catch(() => {});
  }

  return NextResponse.json({
    original: bubbles,
    applied,
    rulesUsed: {
      all: ctx.rules.all.map((r: any) => r.ruleText),
      factory: ctx.rules.factory.map((r: any) => r.ruleText),
      ids: ctx.ruleIds,
    },
    examplesUsed: ctx.examples.length,
  });
}
