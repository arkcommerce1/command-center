import { expect, test } from "@playwright/test";

import { promises as fs } from "node:fs";
import path from "node:path";

// Actionables e2e (one-card design — see docs/STACK.md "Session Start Audit"
// and CLAUDE.md's Actionables spec).
//
// The 3 tests below asserted login-enforced behavior against the old,
// abandoned Vercel deployment. Two things changed since they were written:
// (1) that Vercel URL is no longer the live site (HANDOVER.md — VPS-only
// now), and (2) auth is intentionally disabled dashboard-wide (src/proxy.ts
// is a passthrough) until Haim asks for it back. Asserting a redirect that
// will never happen just makes `npm run check` red for a reason that has
// nothing to do with this feature, so these are skipped with the reason
// on record instead of silently deleted or (worse) "fixed" by re-enabling
// auth, which nobody asked for.
const AUTH_SKIP_REASON =
  "auth is intentionally disabled (see HANDOVER.md) — re-enable this test if/when Haim turns auth back on";

test("logged-out actionables page redirects to /login", async ({ page, baseURL }) => {
  test.skip(true, AUTH_SKIP_REASON);
  await page.goto("/dashboard/actionables", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login/);
  expect(baseURL).toBeTruthy();
});

test("logged-out dashboard approve POST returns 401", async ({ request }) => {
  test.skip(true, AUTH_SKIP_REASON);
  const r = await request.post("/api/decisions/draft:x/action", { data: { action: "approve" } });
  expect(r.status()).toBe(401);
});

test("logged-out decisions GET returns 401", async ({ request }) => {
  test.skip(true, AUTH_SKIP_REASON);
  const r = await request.get("/api/decisions");
  expect(r.status()).toBe(401);
});

test.describe
  .serial("Actionables — one card per conversation (local)", () => {
    test.skip(process.env.E2E_LOCAL !== "1", "needs local seeded server");

    const agentFile = () => path.join(process.cwd(), "data", "agent.json");
    async function outboxRows() {
      return (JSON.parse(await fs.readFile(agentFile(), "utf8")).outbox || []) as Record<string, unknown>[];
    }

    test.beforeEach(async ({ context }) => {
      const cookie = (await fs.readFile(path.join(process.cwd(), "tests", "e2e", ".e2e-cookie"), "utf8")).trim();
      await context.addCookies([{ name: "authjs.session-token", value: cookie, domain: "127.0.0.1", path: "/" }]);
    });

    test("one card per conversation, no internal codes, product dropdown when unlinked", async ({ page }) => {
      await page.goto("/dashboard/actionables", { waitUntil: "networkidle" });
      // No card should render an internal code (D1.3), an importance badge,
      // or a separate question-card type — see CLAUDE.md's Actionables spec.
      await expect(page.getByText(/^D\d+\.\d+$/)).toHaveCount(0);
      await expect(page.getByTestId("card-actionable").first()).toBeVisible();
    });

    test("approve sends the draft and the card disappears", async ({ page }) => {
      await page.goto("/dashboard/actionables", { waitUntil: "networkidle" });
      const card = page.getByTestId("card-actionable").filter({ hasText: "80% cotton" });
      const before = await page.getByTestId("card-actionable").count();
      await card.getByTestId("approve-btn").click();
      await expect(page.getByTestId("card-actionable")).toHaveCount(before - 1);
      const rows = await outboxRows();
      expect(
        rows.some((r) => Array.isArray(r.bubbles) && (r.bubbles as string[]).some((b) => b.includes("cotton"))),
      ).toBe(true);
    });

    test("suggest changes rewrites the reply in the same card", async ({ page }) => {
      await page.goto("/dashboard/actionables", { waitUntil: "networkidle" });
      const card = page.getByTestId("card-actionable").filter({ hasText: "tracking number" });
      await card.getByTestId("suggest-btn").click();
      await card.getByTestId("suggest-box").fill("mention the PO number");
      await card.getByTestId("suggest-submit").click();
      await expect(card).toBeVisible();
    });

    test("disapprove closes the old draft and Donna writes a fresh one in the same card", async ({ page }) => {
      await page.goto("/dashboard/actionables", { waitUntil: "networkidle" });
      const card = page.getByTestId("card-actionable").filter({ hasText: "tracking number" });
      await card.getByTestId("disapprove-btn").click();
      await expect(card).toBeVisible(); // still there — a fresh draft replaced the old one
    });

    test("ignore closes the card with no reply needed", async ({ page }) => {
      await page.goto("/dashboard/actionables", { waitUntil: "networkidle" });
      const before = await page.getByTestId("card-actionable").count();
      await page.getByTestId("card-actionable").first().getByTestId("ignore-btn").click();
      await expect(page.getByTestId("card-actionable")).toHaveCount(before - 1);
    });

    test("empty state appears when nothing is left", async ({ page }) => {
      await page.goto("/dashboard/actionables", { waitUntil: "networkidle" });
      const remaining = await page.getByTestId("card-actionable").count();
      for (let i = 0; i < remaining; i++) {
        await page.getByTestId("card-actionable").first().getByTestId("ignore-btn").click();
        await page.waitForTimeout(200);
      }
      await expect(page.getByTestId("empty-state")).toHaveText("Nothing needs you right now.");
    });
  });
