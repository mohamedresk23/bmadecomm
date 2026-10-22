import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

it("compiles and runs the CLI entry point with isolated memory database and rejects invalid arguments", () => {
  // Restricted Windows workers deny os.userInfo(); this supplies only tsx's
  // temporary IPC namespace, without mocking the command or database/storage.
  const bootstrap = `require('node:os').userInfo = () => ({ username: 'catalog-cli-fixture' }); process.argv = [process.execPath, ${JSON.stringify(path.resolve("scripts/reconcile-catalog-public-media.ts"))}, '--storage-root', 'relative']; require('tsx/cjs'); require(process.argv[1]);`;
  const result = spawnSync(process.execPath, ["-e", bootstrap], {
    env: { ...process.env, NODE_ENV: "test", TEST_DATABASE_MODE: "pglite", DATABASE_URL: "" }, encoding: "utf8", timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Catalog media reconciliation failed; check arguments and database availability");
  expect(result.stderr).not.toContain("TransformError");
});
