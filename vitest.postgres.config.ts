import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.postgres.test.ts"],
  fileParallelism: false, testTimeout: 15000, hookTimeout: 30000,
  env: { TEST_DATABASE_MODE: "postgres" } } });
