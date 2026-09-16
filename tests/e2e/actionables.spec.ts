import { promises as fs } from "fs";
import path from "path";
import { expect, test } from "@playwright/test";

// Goal 7 Actionables e2e.
//
// Prod-safe (run in every `npm run check`): logged-out auth guards only.
// Local write flows run only with E2E_LOCAL=1 against a local server seeded
// with tests/e2e/seed-goal7.mjs plus a minted session cookie:
//   node tests/e2e/seed-goal7.mjs
//   AUTH_SECRET=e2e-secret-local node tests/e2e/mint-cookie.mjs
//   AUTH_SECRET=e2e-secret-local CC_AGENT_TOKEN=e2e-token npx next start -p 3100
//   E2E_LOCAL=1 E2E_AGENT_TOKEN=e2e-token BASE_URL=http://127.0.0.1:3100 npx playwright test actionables
//   node tests/e2e/seed-goal7.mjs --restore

test("logged-out actionables page redirects to /login", async ({ page, baseURL }) => {
  if (process.env.E2E_LOCAL === "1") test.skip();
  await page.goto("/dashboard/actionables", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login/);
  expect(baseURL).toBeTruthy();
});

test("logged-out dashboard approve POST returns 401", async ({ request }) => {
  if (process.env.E2E_LOCAL === "1") test.skip();
  const r = await request.post("/api/drafts/x/versions/y/approve", { data: {} });
  expect(r.status()).toBe(401);
});

test("logged-out decisions GET returns 401", async ({ request }) => {
  if (process.env.E2E_LOCAL === "1") test.skip();
  const r = await request.get("/api/decisions");
  expect(r.status()).toBe(401);
});

test.describe.serial("goal 7 decisions (local)", () => {
  test.skip(process.env.E2E_LOCAL !== "1", "needs local seeded server");

  const agentFile = () => path.join(process.cwd(), "data", "agent.json");
  async function outboxRows() {
    return (JSON.parse(await fs.readFile(agentFile(), "utf8")).outbox || []) as any[];
  }

  test.beforeEach(async ({ context }) => {
    const cookie = (await fs.readFile(path.join(process.cwd(), "tests", "e2e", ".e2e-cookie"), "utf8")).trim();
    await context.addCookies([
      { name: "authjs.session-token", value: cookie, domain: "127.0.0.1", path: "/" },
    ]);
  });

  test("counter, card types, no pipeline ideas", async ({ page }) => {
    await page.goto("/dashboard/actionables", { waitUntil: "networkidle" });
    await expect(page.getByTestId("counter")).toHaveText("2 to approve, 3 questions, 0 samples");
    await expect(page.getByTestId("card-message")).toHaveCount(2);
    await expect(page.getByTestId("card-fee")).toHaveCount(1);
    await expect(page.getByTestId("card-question")).toHaveCount(1);
    await expect(page.getByTestId("card-product_pick")).toHaveCount(1);
    await expect(page.getByText("Pipeline", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Ideas", { exact: false })).toHaveCount(0);
    // Nudge (follow-up) card shows send-timing buttons; reply card shows Approve.
    await expect(page.getByTestId("send-tomorrow-btn")).toHaveCount(1);
    await expect(page.getByTestId("approve-btn")).toHaveCount(1);
    // Fee card shows the exact @Yuki message.
    await expect(page.getByTestId("fee-message")).toContainText("@Yuki can you pay the sample fee of 200 RMB");
  });

  test("approve queues one outbox row; WhatsApp double-approve sends once", async ({ page, request, baseURL }) => {
    await page.goto("/dashboard/actionables", { waitUntil: "networkidle" });
    const replyCard = page.getByTestId("card-message").filter({ hasText: "80% cotton" });
    await replyCard.getByTestId("approve-btn").click();
    await expect(page.getByTestId("counter")).toHaveText("1 to approve, 3 questions, 0 samples");

    let rows = await outboxRows();
    const forA = rows.filter((r) => r.draft_version_id === "g7-ver-a1");
    expect(forA).toHaveLength(1);
    expect(forA[0].status).toBe("queued");
    expect(forA[0].bubbles).toEqual([
      "Hi Mei, thanks for the photos.",
      "Could you confirm the fabric is 80% cotton?",
    ]);

    // Draft A is the oldest draft -> code D1. WhatsApp Y after dashboard approve.
    const token = process.env.E2E_AGENT_TOKEN;
    expect(token).toBeTruthy();
    const r = await request.post(`${baseURL}/api/agent/approval-reply`, {
      headers: { authorization: `Bearer ${token}` },
      data: { text: "Y1.1", from: "haim" },
    });
    expect(r.ok()).toBeTruthy();
    expect((await r.json()).action).toBe("already_approved");
    rows = await outboxRows();
    expect(rows.filter((x) => x.draft_version_id === "g7-ver-a1")).toHaveLength(1);
  });

  test("suggest creates v2 with highlights; v1 approve is refused", async ({ page }) => {
    await page.goto("/dashboard/actionables", { waitUntil: "networkidle" });
    const nudge = page.getByTestId("card-message").filter({ hasText: "tracking number" });
    await nudge.getByTestId("suggest-btn").click();
    await nudge.getByTestId("suggest-box").fill("mention the PO number");
    await nudge.getByTestId("suggest-submit").click();
    await expect(nudge.getByTestId("version-2")).toBeVisible();
    await expect(nudge.getByTestId("word-diff")).toBeVisible();
    await expect(nudge.getByTestId("diff-ins")).toContainText("PO number");
    await expect(nudge.getByTestId("version-1")).toContainText("superseded");
  });

  test("fee approve queues exactly the shown message", async ({ page }) => {
    await page.goto("/dashboard/actionables", { waitUntil: "networkidle" });
    const shown = (await page.getByTestId("fee-message").textContent()) || "";
    expect(shown).toContain("@Yuki");
    await page.getByTestId("fee-approve").click();
    await expect(page.getByTestId("card-fee")).toHaveCount(0);
    const rows = await outboxRows();
    const fee = rows.filter((r) => r.draft_version_id === "fee:g7-fee-1");
    expect(fee).toHaveLength(1);
    expect(fee[0].bubbles).toEqual([shown.trim()]);
  });

  test("disapprove closes the draft; empty state appears when all done", async ({ page, request, baseURL }) => {
    const token = process.env.E2E_AGENT_TOKEN;
    // Answer the remaining question + product_pick via API so only the nudge draft is left.
    for (const [id, data] of [
      ["g7-q-1", { answer: "Yes, blue works." }],
      ["g7-pick-1", { answer: { productId: "prod-1" } }],
    ] as const) {
      await request.post(`${baseURL}/api/questions/${id}/answer`, { data });
    }
    await page.goto("/dashboard/actionables", { waitUntil: "networkidle" });
    const nudge = page.getByTestId("card-message").filter({ hasText: "tracking number" });
    await expect(nudge).toHaveCount(1);
    await nudge.getByTestId("disapprove-btn").click();
    await nudge.getByTestId("disapprove-confirm").click();
    await expect(page.getByTestId("empty-state")).toHaveText("Nothing needs you right now.");
  });
});
