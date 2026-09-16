import { expect, test } from "@playwright/test";

const BASE = "https://command-center-review-tau.vercel.app";

test("logged-out dashboard visit redirects to /login", async ({ request }) => {
  const r = await request.get(`${BASE}/dashboard/actionables`, { maxRedirects: 0 });
  expect([307, 308]).toContain(r.status());
  expect(r.headers().location ?? "").toContain("/login");
});

test("logged-out non-agent API returns 401", async ({ request }) => {
  const r = await request.get(`${BASE}/api/products`);
  expect(r.status()).toBe(401);
});

test("Agent API without token returns its own 401", async ({ request }) => {
  const r = await request.post(`${BASE}/api/agent/tick`);
  expect(r.status()).toBe(401);
});
