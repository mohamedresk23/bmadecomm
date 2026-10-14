import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { localDatabaseUrl } from "./local-database-config";
import * as schema from "../src/db/schema";
import { type DbContext, withTransaction } from "../src/db/tx";
import { createCategory, deleteCategory } from "../src/modules/catalog/categories/application/category-service";
import { createProduct, updateProduct, getProductById, listProducts } from "../src/modules/catalog/products/application/product-service";

// Run explicitly with: npx tsx scripts/verify-product-concurrency.ts
// No public schema fallback and no application rows are read or written.
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
const isolated = `catalog_e04_02_${randomBytes(16).toString("hex")}`;
const expectedSchema = isolated;
function checkedSchema() {
  assert.equal(isolated, expectedSchema);
  assert.match(isolated, /^catalog_e04_02_[a-f0-9]{32}$/);
  return `"${isolated}"`;
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
let stage = "local connection configuration";
async function main() {
  const url = localDatabaseUrl();
  const admin = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const workers: ReturnType<typeof postgres>[] = [];
  let created = false;
  try {
    stage = "isolated schema creation";
    await admin.unsafe(`CREATE SCHEMA ${checkedSchema()}`); created = true;
    function open() {
      checkedSchema();
      const client = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {},
        connection: { search_path: isolated, statement_timeout: 15000, lock_timeout: 10000 } });
      workers.push(client); return client;
    }
    const first = open(), second = open();
    stage = "isolated worker search path";
    for (const connection of [first, second]) {
      const [settings] = await connection`SELECT current_schema() AS schema, current_setting('search_path') AS path`;
      assert.equal(settings.schema, isolated); assert.equal(settings.path, isolated);
    }
    stage = "migration journal loading";
    const journal = JSON.parse(await readFile("src/db/migrations/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
    for (const entry of journal.entries) {
      assert.match(entry.tag, /^\d{4}_[a-z0-9_]+$/);
      stage = `isolated migration ${entry.tag}`;
      const ddl = (await readFile(`src/db/migrations/${entry.tag}.sql`, "utf8")).replaceAll('"public".', `${checkedSchema()}.`);
      // Migration SQL must stay in this schema; deny explicit namespace/connection changes.
      assert.ok(!/\b(?:public\s*\.|(?:set|reset)\s+(?:search_path|schema)|(?:create|alter|drop)\s+(?:database|schema))\b/i.test(ddl));
      for (const statement of ddl.split("--> statement-breakpoint")) if (statement.trim()) await first.unsafe(statement);
    }
    const one = drizzle(first, { schema }) as DbContext, two = drizzle(second, { schema }) as DbContext;
    const [{ pid: firstPid }] = await first`SELECT pg_backend_pid() AS pid`;
    const [{ pid: secondPid }] = await second`SELECT pg_backend_pid() AS pid`;
    assert.notEqual(firstPid, secondPid);
    async function blocked() {
      for (let attempt = 0; attempt < 100; attempt++) {
        const [{ blockers }] = await admin`SELECT pg_blocking_pids(${secondPid}) AS blockers`;
        if ((blockers as number[]).includes(firstPid)) return;
        await delay(20);
      }
      assert.fail("Expected the second independent connection to wait on the first");
    }
    const category = await createCategory(one, { name: "Version one category" }, "verification");
    const nextCategory = await createCategory(one, { name: "Version two category" }, "verification");
    const input = { name: "Version one", description: "Old complete aggregate", categoryIds: [category.id],
      variants: [{ sku: "SNAPSHOT-A", priceMinor: "9007199254740993", comparePriceMinor: "9007199254740994", attributes: { color: "red", size: "m" } }] };
    const before = await createProduct(one, input, "verification", undefined, "EGP:2");
    stage = "overlapping readers and product edit";
    const edited = gate(), releaseEdit = gate();
    let after = before;
    const writer = withTransaction(one, async tx => {
      after = await updateProduct(tx, before.id, { ...input, name: "Version two", description: "New complete aggregate", categoryIds: [nextCategory.id],
        variants: [{ id: before.variants[0].id, sku: "SNAPSHOT-B", priceMinor: "9007199254740995", attributes: { color: "blue" } }] }, "verification", undefined, "EGP:2");
      edited.resolve(); await releaseEdit.promise;
    });
    // A failed writer must release the reader barrier instead of hanging.
    void writer.catch(() => edited.resolve());
    await edited.promise;
    try {
      assert.deepEqual(await getProductById(two, before.id), before);
      assert.deepEqual((await listProducts(two)).find(product => product.id === before.id), before);
      const versions = new Set<string>();
      const reader = (async () => {
        for (let attempt = 0; attempt < 40; attempt++) {
          const detail = await getProductById(two, before.id);
          const listed = (await listProducts(two)).find(product => product.id === before.id);
          for (const product of [detail, listed]) {
            assert.ok(product); assert.deepEqual(product, product.name === before.name ? before : after);
            versions.add(product.name);
          }
          if (attempt === 0) releaseEdit.resolve();
        }
      })();
      await Promise.all([writer, reader]);
      assert.deepEqual(await getProductById(two, before.id), after);
      versions.add((await getProductById(two, before.id)).name);
      assert.ok(versions.has(before.name) && versions.has(after.name));
    } finally { releaseEdit.resolve(); await writer.catch(() => {}); }
    console.log("PASS: concurrent detail/list reads contain complete old or new aggregates and exact money");

    stage = "settings change serializes stale product creation";
    const settingsReady = gate(), releaseSettings = gate();
    const settingsWriter = withTransaction(one, async tx => {
      await tx.update(schema.storeSettings).set({ currency: "KWD", currencyExponent: 3 }).where(eq(schema.storeSettings.id, "default"));
      settingsReady.resolve(); await releaseSettings.promise;
    });
    void settingsWriter.catch(() => settingsReady.resolve());
    await settingsReady.promise;
    const staleCreate = createProduct(two, { ...input, variants: [{ sku: "STALE-CONTEXT", priceMinor: "29", attributes: {} }] }, "verification", undefined, "EGP:2");
    // Attach the expected rejection before releasing the blocking transaction.
    const staleAssertion = assert.rejects(staleCreate, (error: unknown) => (error as { statusCode?: number }).statusCode === 409);
    try { await blocked(); } finally { releaseSettings.resolve(); }
    await Promise.all([settingsWriter, staleAssertion]);
    assert.equal((await listProducts(two)).length, 1);
    console.log("PASS: settings row lock rejects stale pricing after the concurrent settings commit");

    stage = "category deletion serializes association creation";
    const removedCategory = await createCategory(one, { name: "Deleted before association" }, "verification");
    const deleted = gate(), releaseDelete = gate();
    const deletion = withTransaction(one, async tx => {
      await deleteCategory(tx, removedCategory.id, "verification"); deleted.resolve(); await releaseDelete.promise;
    });
    void deletion.catch(() => deleted.resolve()); await deleted.promise;
    const missingCategoryCreate = createProduct(two, { ...input, categoryIds: [removedCategory.id], variants: [{ sku: "REMOVED-CATEGORY", priceMinor: "29", attributes: {} }] }, "verification", undefined, "KWD:3");
    const missingAssertion = assert.rejects(missingCategoryCreate, (error: unknown) => (error as { statusCode?: number }).statusCode === 422);
    try { await blocked(); } finally { releaseDelete.resolve(); }
    await Promise.all([deletion, missingAssertion]);
    assert.equal((await listProducts(two)).length, 1);
    console.log("PASS: category deletion lock prevents association with a concurrently deleted category");

    stage = "category association serializes deletion";
    const assignedCategory = await createCategory(one, { name: "Associated before deletion" }, "verification");
    const assigned = gate(), releaseAssigned = gate();
    const association = withTransaction(one, async tx => {
      const product = await createProduct(tx, { ...input, categoryIds: [assignedCategory.id], variants: [{ sku: "ASSIGNED-CATEGORY", priceMinor: "29", attributes: {} }] }, "verification", undefined, "KWD:3");
      assigned.resolve(); await releaseAssigned.promise; return product;
    });
    void association.catch(() => assigned.resolve()); await assigned.promise;
    const deniedDelete = assert.rejects(deleteCategory(two, assignedCategory.id, "verification"), (error: unknown) => (error as { statusCode?: number }).statusCode === 409);
    try { await blocked(); } finally { releaseAssigned.resolve(); }
    const [saved] = await Promise.all([association, deniedDelete]);
    assert.deepEqual((await getProductById(two, saved.id)).categoryIds, [assignedCategory.id]);
    assert.equal((await two.select().from(schema.auditEvents).where(eq(schema.auditEvents.resource, `product:${saved.id}`))).length, 1);
    console.log("PASS: association key-share lock preserves category and product after concurrent deletion attempt");
  } finally {
    // End workers before dropping only the schema created by this invocation.
    for (const worker of workers) await worker.end({ timeout: 5 });
    try { if (created) await admin.unsafe(`DROP SCHEMA ${checkedSchema()} CASCADE`); }
    finally { await admin.end({ timeout: 5 }); }
  }
}
main().then(() => console.log("Product concurrency verification passed; isolated schema removed.")).catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
  console.error(`Product concurrency verification failed at: ${stage} (${code}). Connection details and SQL values omitted.`);
  process.exitCode = 1;
});
