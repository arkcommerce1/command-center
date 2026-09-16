import { NextRequest, NextResponse } from "next/server";

/** Fail-closed Bearer auth for /api/agent/*. 401 when unset or mismatched. */
export function agentAuth(req: NextRequest): NextResponse | null {
  const token = process.env.CC_AGENT_TOKEN;
  const header = req.headers.get("authorization") || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", message: "CC_AGENT_TOKEN is not set. Set CC_AGENT_TOKEN on the server and send Authorization: Bearer <token>." },
      { status: 401 },
    );
  }
  if (!presented || presented !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/** Parse JSON body safely; returns [body, errorResponse]. */
export async function agentBody(req: NextRequest): Promise<[any, NextResponse | null]> {
  try {
    return [await req.json(), null];
  } catch {
    return [null, NextResponse.json({ error: "invalid_json" }, { status: 400 })];
  }
}
