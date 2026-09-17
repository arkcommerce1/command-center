import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { dbById, dbUpdate } from "@/lib/cc/agent-store";

// PATCH /api/learned-rules/[id] — edit a rule's text or scope.
// Body: { ruleText?: string, scope?: "all" | "factory", factoryName?: string }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}) as any);
  const patch: Record<string, any> = { updatedAt: Date.now() };
  if (typeof b?.ruleText === "string" && b.ruleText.trim().length >= 3) {
    patch.ruleText = b.ruleText.trim();
  }
  if (b?.scope === "all" || b?.scope === "factory") {
    patch.scope = b.scope;
    patch.factoryId = null;
    patch.factoryName = b.scope === "factory" ? String(b?.factoryName || "").trim() || null : null;
  }
  const updated = await dbUpdate("learnedRules", id, patch);
  if (!updated) return NextResponse.json({ error: "rule not found" }, { status: 404 });
  return NextResponse.json({ rule: updated });
}

// DELETE /api/learned-rules/[id] — soft-delete a rule (status → "deleted").
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rule = await dbById("learnedRules", id);
  if (!rule) return NextResponse.json({ error: "rule not found" }, { status: 404 });
  const updated = await dbUpdate("learnedRules", id, {
    status: "deleted",
    updatedAt: Date.now(),
  });
  return NextResponse.json({ rule: updated });
}
