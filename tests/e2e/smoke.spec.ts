import { expect, test } from "@playwright/test";

// Goal 1 smoke test: with login enforced, every logged-out dashboard page
// visit must land on /login (redirect), and /login itself must render
// without crashing. Read-only GETs only.
const DASHBOARD_PAGES = [
  "/dashboard/actionables",
  "/dashboard/products",
  "/dashboard/contacts",
  "/dashboard/factories",
  "/dashboard/activity",
  "/dashboard/settings/playbook",
];

for (const path of DASHBOARD_PAGES) {
  test(`smoke: logged-out ${path} lands on /login`, async ({ page }) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("Application error", { exact: false })).toHaveCount(0);
  });
}

test("smoke: /login renders sign-in", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toBeVisible();
  await expect(page.getByText("Sign in", { exact: false }).first()).toBeVisible();
});

test("smoke: product detail without login lands on /login", async ({ page }) => {
  await page.goto("/dashboard/products/probe-nonexistent-id", {
    waitUntil: "domcontentloaded",
  });
  await expect(page).toHaveURL(/\/login/);
});
