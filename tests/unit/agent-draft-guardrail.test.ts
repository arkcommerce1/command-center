import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";

import { dbFind } from "@/lib/cc/agent-store";
import { POST } from "@/app/api/agent/drafts/route";

process.env.CC_AGENT_TOKEN = process.env.CC_AGENT_TOKEN || "test-token";
const AUTH = { authorization: "Bearer test-token", "content-type": "application/json" };

function req(body: any) {
  return new NextRequest("http://test/api/agent/drafts", {
    method: "POST",
    headers: AUTH as any,
    body: JSON.stringify(body),
  });
}

describe("drafts guardrail (SPEC §1.3: blocked draft becomes guardrail_block question)", () => {
  beforeAll(() => {
    if (!process.env.CC_AGENT_TOKEN) process.env.CC_AGENT_TOKEN = "test-token";
  });

  it("blocked draft becomes a guardrail_block question, not a draft", async () => {
    const fp = `fp-guard-${Date.now()}`;
    const res = await POST(
      req({ factory_product_id: fp, chat_id: "chat-1", kind: "reply", bubbles: ["Our MOQ is 500 pieces."] }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.blocked).toBe(true);
    expect(body.question.kind).toBe("guardrail_block");
    // No draft was created for this factory+product.
    expect(await dbFind("drafts", (d) => d.factory_product_id === fp)).toEqual([]);
  });

  it("clean draft creates (or versions) the pending draft", async () => {
    const fp = `fp-clean-${Date.now()}`;
    const res = await POST(
      req({ factory_product_id: fp, chat_id: "chat-1", kind: "reply", bubbles: ["Could you confirm the material?"] }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft.factory_product_id).toBe(fp);
    expect(body.version.version).toBe(1);
  });
});
