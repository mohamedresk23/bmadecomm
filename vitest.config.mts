import { defineConfig, configDefaults } from "vitest/config";

// PGlite allocates a WASM database per suite. Keep the default command usable
// on development machines rather than spawning one database per CPU.
export default defineConfig({ test: { maxWorkers: 1, exclude: [...configDefaults.exclude, ".local/**"] } });
