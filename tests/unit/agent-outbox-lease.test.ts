import { NextRequest } from "next/server";

import { describe, expect, it } from "vitest";

import { POST as claim } from "@/app/api/agent/outbox/claim/route";
import { __resetAgentDb, dbGet, dbInsert, dbPut } from "@/lib/cc/agent-store";

process.env.CC_AGENT_TOKEN = process.env.CC_AGENT_TOKEN || "test-token";
const AUTH = { authorization: "Bearer test-token", "content-type": "application/json" };

function claimReq() {
  return new NextRequest("http://test/api/agent/outbox/claim", {
    method: "POST",
    headers: AUTH as unknown as HeadersInit,
  });
}

describe("outbox claim lease (SPEC §1.3: one winner)", () => {
  it("two concurrent claims give one winner", async () => {
    __resetAgentDb();
    const tag = `lease-${Date.now()}`;
    await dbInsert("outbox", { status: "queued", chat_id: "c1", bubbles: ["hi"], tag });
    const [r1, r2] = await Promise.all([claim(claimReq()), claim(claimReq())]);
    const b1 = await r1.json();
    const b2 = await r2.json();
    const winners = [b1.outbox, b2.outbox].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0].lease_token).toBeTruthy();
    expect(winners[0].lease_expires_at).toBeGreaterThan(Date.now());
    // Loser got null.
    expect([b1.outbox, b2.outbox]).toContain(null);
    // Cleanup.
    await dbPut("outbox", (await dbGet("outbox")).filter((x: unknown) => (x as { tag?: string }).tag !== tag) as never);
    __resetAgentDb();
  });
});
