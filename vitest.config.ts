import { defineConfig } from "vitest/config";
import path from "node:path";
import { existsSync, statSync } from "node:fs";

const outboxScaffold = "src/shared/outbox/outbox.test.ts";
const emptyScaffolds = existsSync(outboxScaffold) && statSync(outboxScaffold).size === 0
  ? [outboxScaffold] : [];

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { fileParallelism: false, testTimeout: 15000, hookTimeout: 30000,
    // This pre-existing, zero-byte scaffold contains no executable tests.
    // Keep it outside suite discovery without excluding any actual outbox tests.
    exclude: ["node_modules/**", "**/*.postgres.test.ts", ...emptyScaffolds] },
});
