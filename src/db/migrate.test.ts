import { describe, it, expect } from "vitest";
import { runMigrations } from "./migrate";
import { db } from "./index";
import { migrationsTest } from "./schema";

describe("Database Migrations", () => {
  it("applies migrations idempotently", async () => {
    // First run
    await runMigrations();
    
    // Check if table exists
    const res1 = await db.select().from(migrationsTest).limit(1);
    expect(res1).toBeDefined();

    // Second run should not throw
    await expect(runMigrations()).resolves.toBeUndefined();
  }, 15000);
});
