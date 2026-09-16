import { expect, test } from "@playwright/test";

// Goal 0 smoke test: every dashboard page on the LIVE site must return 200
// and render without crashing. Read-only GETs only — no seeded DB needed
// (see playwright.config.ts comment for the seeded-test-DB plan).
// NOTE: product detail uses a probe id; it passes if the page renders for a
// real id OR returns a clean 404 page (no crash either way).
const DASHBOARD_PAGES = [
  "/dashboard/actionables",
  "/dashboard", // tonight-redirect (redirects to /dashboard/tonight)
  "/dashboard/products",
  "/dashboard/contacts",
  "/dashboard/factories",
  "/dashboard/activity",
  "/dashboard/settings/playbook",
];

for (const path of DASHBOARD_PAGES) {
  test(`smoke: ${path} returns 200 and renders`, async ({ page }) => {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${path} HTTP status`).toBe(200);
    await expect(page.locator("body")).toBeVisible();
    // No crash: Next.js error boundary / global error must not appear.
    await expect(page.getByText("Application error", { exact: false })).toHaveCount(0);
  });
}

test("smoke: product detail renders without crashing", async ({ page }) => {
  // Find a real product id from the products page first.
  await page.goto("/dashboard/products", { waitUntil: "domcontentloaded" });
  const productLink = page.locator('a[href*="/dashboard/products/"]').first();
  if ((await productLink.count()) > 0) {
    const href = await productLink.getAttribute("href");
    expect(href).toBeTruthy();
    const response = await page.goto(href as string, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${href} HTTP status`).toBe(200);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("Application error", { exact: false })).toHaveCount(0);
  } else {
    // No products listed: probe a detail URL and accept a clean 404 page.
    const response = await page.goto("/dashboard/products/probe-nonexistent-id", {
      waitUntil: "domcontentloaded",
    });
    expect([200, 404]).toContain(response?.status());
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("Application error", { exact: false })).toHaveCount(0);
  }
});
