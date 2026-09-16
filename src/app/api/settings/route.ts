import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getSettings, pgInit, saveSettings } from "@/lib/cc/store";
import { normSettings } from "@/lib/cc/types";

// GET /api/settings — durable "playbook" config, returns defaults if unset.
export async function GET() {
  await pgInit();
  const settings = await getSettings();
  return NextResponse.json(settings);
}

// PATCH /api/settings — partial update, merged onto current (or default) settings.
export async function PATCH(req: NextRequest) {
  await pgInit();
  const body = await req.json();
  const current = await getSettings();
  const merged = normSettings({ ...current, ...body });
  await saveSettings(merged);
  return NextResponse.json(merged);
}
