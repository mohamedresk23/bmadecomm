import { beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrationsTest, operationKeys } from "../../db/schema";
import { setupTestDb, withIsolatedTx } from "../../test-utils/db";
import { canonicalJson, executeIdempotent } from "./execute";

beforeAll(setupTestDb);
it("replays canonical payload, isolates scope and rejects changed retry", () => withIsolatedTx(async tx => {
  let calls = 0;
  const input = { actor: "actor", operation: "command", key: "key", payload: { b: 2, a: 1 } };
  const callback = async () => { calls++; return { count: calls }; };
  expect(await executeIdempotent(tx, input, callback)).toEqual({ count: 1 });
  expect(await executeIdempotent(tx, { ...input, payload: { a: 1, b: 2 } }, callback)).toEqual({ count: 1 });
  await expect(executeIdempotent(tx, { ...input, payload: { a: 2, b: 2 } }, callback)).rejects.toMatchObject({ statusCode: 409 });
  expect(calls).toBe(1);
  await executeIdempotent(tx, { ...input, actor: "other" }, callback);
  await executeIdempotent(tx, { ...input, operation: "other" }, callback);
  expect(calls).toBe(3);
}));
it("rolls back business mutation and key on callback/result failure then retries", () => withIsolatedTx(async tx => {
  const input = { actor: "actor", operation: "rollback", key: "key", payload: null };
  await expect(executeIdempotent(tx, input, async nested => {
    await nested.insert(migrationsTest).values({ id: "effect" }); throw new Error("safe failure");
  })).rejects.toThrow("safe failure");
  expect(await tx.select().from(migrationsTest).where(eq(migrationsTest.id, "effect"))).toHaveLength(0);
  expect(await tx.select().from(operationKeys).where(eq(operationKeys.operation, "rollback"))).toHaveLength(0);
  expect(await executeIdempotent(tx, input, async nested => {
    await nested.insert(migrationsTest).values({ id: "effect" }); return null;
  })).toBeNull();
  expect(await executeIdempotent(tx, input, async () => "never")).toBeNull();
  await expect(executeIdempotent(tx, { ...input, key: "invalid" }, async () => NaN)).rejects.toMatchObject({ statusCode: 400 });
}));
it("rejects non-JSON values without silently dropping data", () => {
  for (const value of [undefined, NaN, Infinity, new Date(), { a: undefined }, Array(2), BigInt(1), { [Symbol()]: 1 }])
    expect(() => canonicalJson(value)).toThrow();
  const cyclic: unknown[] = []; cyclic.push(cyclic);
  expect(() => canonicalJson(cyclic)).toThrow();
});

it("bounds each scope field by UTF-8 bytes before touching the database", () => withIsolatedTx(async tx => {
  const input = { actor: "actor", operation: "command", key: "key", payload: null };
  for (const field of ["actor", "operation", "key"] as const) {
    let calls = 0;
    for (const value of ["", "a".repeat(129), "é".repeat(65)])
      await expect(executeIdempotent(tx, { ...input, [field]: value }, async () => { calls++; return null; }))
        .rejects.toMatchObject({ statusCode: 400 });
    expect(calls).toBe(0);
    await expect(executeIdempotent(tx, { ...input, [field]: "é".repeat(64) }, async () => "accepted"))
      .resolves.toBe("accepted");
    await expect(executeIdempotent(tx, { ...input, [field]: "a".repeat(128) }, async () => "accepted"))
      .resolves.toBe("accepted");
  }
}));
it("rejects PostgreSQL-incompatible strings and discarded array properties", () => {
  for (const value of ["\u0000", "\ud800", "\udfff", { ["\u0000"]: 1 }, { ["\ud800"]: 1 },
    Object.defineProperty([1], "hidden", { value: 2 }),
    Object.defineProperty([1], "0", { value: 1, enumerable: false }),
    Object.defineProperty([1], "0", { get: () => 1 })])
    expect(() => canonicalJson(value)).toThrow();
  expect(canonicalJson("valid 😀")).toBe(JSON.stringify("valid 😀"));
});
it("rolls back local writes when the callback returns unsupported JSON", () => withIsolatedTx(async tx => {
  for (const result of ["\u0000", "\ud800", Object.defineProperty([1], "hidden", { value: 2 })]) {
    await expect(executeIdempotent(tx, { actor: "actor", operation: "unsupported", key: "key", payload: null }, async nested => {
      await nested.insert(migrationsTest).values({ id: "unsupported-effect" }); return result;
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(await tx.select().from(migrationsTest).where(eq(migrationsTest.id, "unsupported-effect"))).toHaveLength(0);
    expect(await tx.select().from(operationKeys).where(eq(operationKeys.operation, "unsupported"))).toHaveLength(0);
  }
}));
