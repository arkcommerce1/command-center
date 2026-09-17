import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { dbFind } from "@/lib/cc/agent-store";

// GET /api/lessons — list all lesson records (for transparency/debugging).
export async function GET() {
  const lessons = await dbFind("lessons", () => true);
  lessons.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
  return NextResponse.json({ lessons });
}
