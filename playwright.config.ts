import { defineConfig, devices } from "@playwright/test";

// Goal 0 smoke test runs against the LIVE review deployment so no local
// database is needed:
//   https://command-center-review-tau.vercel.app
// Override with BASE_URL env for local runs, e.g. BASE_URL=http://localhost:3000.
//
// SEEDED TEST DATABASE (for later goals — NOT built yet):
// When e2e tests need to write data (approvals, drafts, outbox), point the
// app at a dedicated test database instead of production data:
//   1. Provision a second Postgres database (Neon branch or separate DB).
//   2. Run Drizzle migrations against it with DATABASE_URL set to the test DB.
//   3. Seed it via a tests/e2e/seed.ts script (truncate + insert factories,
//      products, contacts, chats, drafts fixtures).
//   4. Run the dev server with the test DATABASE_URL and set
//      BASE_URL=http://localhost:3000 for Playwright.
// Until then, all e2e tests here are read-only GETs against the live site.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.BASE_URL ?? "https://command-center-review-tau.vercel.app",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // This repo's pinned @playwright/test version expects a
        // chrome-headless-shell binary that isn't always present in every
        // execution environment; fall back to the plain Chromium binary
        // when the env var points at one (e.g. sandboxed CI runners).
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : undefined,
      },
    },
  ],
});
