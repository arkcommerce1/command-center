import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Many tests read/write the same file-backed stores (data/store.json,
    // data/agent.json) with a snapshot-restore around each file. Running
    // test FILES in parallel races on those shared files and flakes
    // (confirmed: every test here passes in isolation). Tests within a file
    // already run sequentially, so this only removes cross-file races.
    fileParallelism: false,
  },
});
