import { NextRequest } from "next/server";

import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/messages/route";
import { __resetAgentDb, dbInsert } from "@/lib/cc/agent-store";

function getReq(query = "") {
  return new NextRequest(`http://test/api/messages${query}`, { method: "GET" });
}

describe("GET /api/messages (dashboard read-only slice)", () => {
  it("returns newest-first rows with chat names + sender, filters by chat_id, clamps limit", async () => {
    __resetAgentDb();
    const tag = `msgtest-${Date.now()}`;
    const c1 = await dbInsert("chats", { external_id: `${tag}-chat-1`, name: `${tag} Factory A`, channel: "whatsapp" });
    const c2 = await dbInsert("chats", { external_id: `${tag}-chat-2`, name: `${tag} Factory B`, channel: "whatsapp" });
    const who = await dbInsert("contacts", { name: `${tag} Li Wei` });
    await dbInsert("messages", {
      external_id: `${tag}-m-old`,
      chat_id: c1.id,
      contact_id: who.id,
      direction: "in",
      text: "你好",
      translation: "hello",
      sent_at: 1000,
    });
    await dbInsert("messages", {
      external_id: `${tag}-m-new`,
      chat_id: c2.id,
      direction: "out",
      text: "ok",
      translation: "",
      sent_at: 2000,
    });
    const mine = (rows: any[]) => rows.filter((m) => [c1.id, c2.id].includes(m.chat_id));

    const all = mine(await (await GET(getReq())).json());
    expect(all).toHaveLength(2);
    expect(all[0].text).toBe("ok"); // newest first
    expect(all[0].chat_name).toBe(`${tag} Factory B`);
    expect(all[1].sender).toBe(`${tag} Li Wei`);
    expect(all[1].translation).toBe("hello");
    expect(all[0]).toMatchObject({ direction: "out", sent_at: 2000 });

    const one = await (await GET(getReq(`?chat_id=${c1.id}`))).json();
    expect(one).toHaveLength(1);
    expect(one[0].chat_id).toBe(c1.id);

    const limited = mine(await (await GET(getReq("?limit=1"))).json());
    expect(limited.length).toBeLessThanOrEqual(1);

    const clamped = await (await GET(getReq("?limit=9999"))).json();
    expect(clamped.length).toBeLessThanOrEqual(200);
    // Cleanup: don't pollute the shared file-backed store for other tests.
    const { dbGet, dbPut } = await import("@/lib/cc/agent-store");
    for (const key of ["messages", "chats", "contacts"] as const) {
      const rows = ((await dbGet(key)) as any[]).filter(
        (x) => x.external_id !== `${tag}-chat-1` && x.external_id !== `${tag}-chat-2` &&
          x.external_id !== `${tag}-m-old` && x.external_id !== `${tag}-m-new` && x.name !== `${tag} Li Wei`,
      );
      await dbPut(key, rows as never);
    }
    __resetAgentDb();
  });
});
