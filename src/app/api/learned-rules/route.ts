import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { dbFind, dbInsert } from "@/lib/cc/agent-store";
import { uid } from "@/lib/cc/types";
import { getApprovalStats } from "@/lib/cc/learning";

// GET /api/learned-rules — list all active + superseded rules.
export async function GET() {
  const rules = await dbFind("learnedRules", (r: any) => r.status !== "deleted");
  const stats = await getApprovalStats();
  return NextResponse.json({ rules, stats });
}

// POST /api/learned-rules — add a rule by hand.
// Body: { ruleText: string, scope: "all" | "factory", factoryName?: string }
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}) as any);
  const ruleText = String(b?.ruleText || "").trim();
  if (!ruleText || ruleText.length < 3) return NextResponse.json({ error: "ruleText required (min 3 chars)" }, { status: 400 });
  const scope = b?.scope === "factory" ? "factory" : "all";
  const factoryName = scope === "factory" ? String(b?.factoryName || "").trim() || null : null;

  const rule = {
    id: uid(),
    ruleText,
    scope,
    factoryId: null as string | null,
    factoryName,
    sourceFeedback: "manual",
    sourceLessonId: null,
    usageCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    supersededById: null,
    status: "active" as const,
  };
  await dbInsert("learnedRules", rule);
  return NextResponse.json({ rule });
}
