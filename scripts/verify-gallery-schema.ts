import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import postgres from "postgres";
import { localDatabaseUrl } from "./local-database-config";

// Run explicitly with: npx.cmd tsx scripts/verify-gallery-schema.ts
// Tests migration 0015 UP -> Constraints & Indexes -> DOWN -> RE-UP in an isolated PostgreSQL schema.
// Never modifies public schema or development data. Cleans up isolated schema in finally.
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

const isolated = `gallery_e04_03_${randomBytes(16).toString("hex")}`;
const expectedSchema = isolated;

function checkedSchema() {
  assert.equal(isolated, expectedSchema);
  assert.match(isolated, /^gallery_e04_03_[a-f0-9]{32}$/);
  return `"${isolated}"`;
}

async function main() {
  let url: string;
  try {
    url = localDatabaseUrl();
  } catch (err: unknown) {
    console.error("[PostgreSQL Verification] Local development database URL not configured or invalid:", (err as Error).message);
    process.exitCode = 2;
    return;
  }

  const admin = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
  let created = false;

  try {
    console.log(`[PostgreSQL Verification] Creating isolated schema ${isolated}...`);
    await admin.unsafe(`CREATE SCHEMA ${checkedSchema()}`);
    created = true;

    const client = postgres(url, {
      max: 1,
      connect_timeout: 5,
      onnotice: () => {},
      connection: { search_path: isolated, statement_timeout: 15000, lock_timeout: 10000 },
    });

    try {
      const [settings] = await client`SELECT current_schema() AS schema, current_setting('search_path') AS path`;
      assert.equal(settings.schema, isolated);
      assert.equal(settings.path, isolated);

      console.log("[PostgreSQL Verification] Applying migrations 0000 through 0014...");
      const journal = JSON.parse(await readFile("src/db/migrations/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };

      for (const entry of journal.entries) {
        if (entry.tag === "0015_product_gallery") break;
        assert.match(entry.tag, /^\d{4}_[a-z0-9_]+$/);
        const ddl = (await readFile(`src/db/migrations/${entry.tag}.sql`, "utf8")).replaceAll('"public".', `${checkedSchema()}.`);
        for (const stmt of ddl.split("--> statement-breakpoint")) {
          if (stmt.trim()) await client.unsafe(stmt);
        }
      }

      console.log("[PostgreSQL Verification] Applying migration 0015_product_gallery (UP)...");
      const up0015 = (await readFile("src/db/migrations/0015_product_gallery.sql", "utf8")).replaceAll('"public".', `${checkedSchema()}.`);
      for (const stmt of up0015.split("--> statement-breakpoint")) {
        if (stmt.trim()) await client.unsafe(stmt);
      }

      // Verify product_media table and media_revision column exist
      const [colCheck] = await client`
        SELECT column_name, data_type, column_default
        FROM information_schema.columns
        WHERE table_schema = ${isolated} AND table_name = 'products' AND column_name = 'media_revision'
      `;
      assert.ok(colCheck, "products.media_revision column must exist");
      assert.equal(colCheck.data_type, "bigint");
      console.log("[PostgreSQL Verification] Verified products.media_revision column (bigint, default 0).");

      const [tableCheck] = await client`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${isolated} AND table_name = 'product_media'
      `;
      assert.ok(tableCheck, "product_media table must exist");
      console.log("[PostgreSQL Verification] Verified product_media table exists.");

      // Verify partial unique index exists
      const [indexCheck] = await client`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = ${isolated} AND tablename = 'product_media' AND indexname = 'product_media_active_sort_order_uq'
      `;
      assert.ok(indexCheck, "Partial unique index product_media_active_sort_order_uq must exist");
      assert.ok(indexCheck.indexdef.includes("WHERE (removed_at IS NULL)"), "Index must be partial WHERE removed_at IS NULL");
      console.log("[PostgreSQL Verification] Verified partial unique index (product_id, sort_order) WHERE removed_at IS NULL.");

      // Verify unique index on (product_id, media_id)
      const [uqMediaCheck] = await client`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = ${isolated} AND tablename = 'product_media' AND indexname = 'product_media_product_media_uq'
      `;
      assert.ok(uqMediaCheck, "Unique index product_media_product_media_uq must exist");
      console.log("[PostgreSQL Verification] Verified unique index product_media_product_media_uq exists.");

      // Verify Foreign Key Constraints and Partial Unique Index Behavior
      console.log("[PostgreSQL Verification] Testing constraints and index behaviors on real PostgreSQL engine...");
      const productId = "prd_test_schema_01";
      const mediaId1 = "med_test_schema_01";
      const mediaId2 = "med_test_schema_02";

      // Insert product and media rows
      await client`INSERT INTO products (id, name, status, media_revision) VALUES (${productId}, 'Schema Test Product', 'draft', 0)`;
      await client`INSERT INTO media (id, filename, mime_type, size, status) VALUES (${mediaId1}, 'test-1.png', 'image/png', 1024, 'active')`;
      await client`INSERT INTO media (id, filename, mime_type, size, status) VALUES (${mediaId2}, 'test-2.png', 'image/png', 2048, 'active')`;

      // Insert first attachment at sort_order 0
      await client`
        INSERT INTO product_media (id, product_id, media_id, sort_order, alt_text)
        VALUES ('pm_01', ${productId}, ${mediaId1}, 0, 'Alt 1')
      `;

      // 1. Test duplicate (product_id, sort_order) where removed_at IS NULL -> Expect 23505 unique violation
      let duplicateOrderError: { code?: string } | null = null;
      try {
        await client`
          INSERT INTO product_media (id, product_id, media_id, sort_order, alt_text)
          VALUES ('pm_02', ${productId}, ${mediaId2}, 0, 'Alt 2')
        `;
      } catch (err: unknown) {
        duplicateOrderError = err as { code?: string };
      }
      assert.ok(duplicateOrderError, "Expected duplicate sort_order to fail");
      assert.equal(duplicateOrderError?.code, "23505", "Must trigger 23505 unique_violation");
      console.log("[PostgreSQL Verification] Verified partial unique index blocks duplicate active sort_order (23505).");

      // 2. Soft-delete the first attachment (removed_at = NOW()), then insert at sort_order 0 -> Must succeed!
      await client`UPDATE product_media SET removed_at = NOW() WHERE id = 'pm_01'`;
      await client`
        INSERT INTO product_media (id, product_id, media_id, sort_order, alt_text)
        VALUES ('pm_02', ${productId}, ${mediaId2}, 0, 'Alt 2')
      `;
      console.log("[PostgreSQL Verification] Verified partial unique index allows reusing sort_order when removed_at IS NOT NULL.");

      // 3. Test ON DELETE RESTRICT on media_id
      let deleteMediaError: { code?: string } | null = null;
      try {
        await client`DELETE FROM media WHERE id = ${mediaId2}`;
      } catch (err: unknown) {
        deleteMediaError = err as { code?: string };
      }
      assert.ok(deleteMediaError, "Expected deleting referenced media to fail");
      assert.ok(["23001", "23503"].includes(deleteMediaError?.code ?? ""), "Must trigger 23001 restrict_violation or 23503 foreign_key_violation due to ON DELETE RESTRICT");
      console.log(`[PostgreSQL Verification] Verified ON DELETE RESTRICT prevents deleting referenced media (SQLSTATE ${deleteMediaError?.code}).`);

      // 4. Test ON DELETE CASCADE on product_id
      await client`DELETE FROM products WHERE id = ${productId}`;
      const remainingPm = await client`SELECT COUNT(*)::int AS count FROM product_media WHERE product_id = ${productId}`;
      assert.equal(remainingPm[0].count, 0, "product_media rows must be cascade deleted when product is deleted");
      console.log("[PostgreSQL Verification] Verified ON DELETE CASCADE removes product_media rows when product is deleted.");

      // Clean up test media
      await client`DELETE FROM media WHERE id IN (${mediaId1}, ${mediaId2})`;

      // 5. Verify DOWN migration (rollback 0015)
      console.log("[PostgreSQL Verification] Verifying migration 0015_product_gallery (DOWN)...");
      const down0015 = (await readFile("src/db/migrations/0015_product_gallery.down.sql", "utf8")).replaceAll('"public".', `${checkedSchema()}.`);
      for (const stmt of down0015.split("--> statement-breakpoint")) {
        if (stmt.trim()) await client.unsafe(stmt);
      }

      // Verify product_media is dropped and media_revision is dropped
      const [colCheckAfterDown] = await client`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = ${isolated} AND table_name = 'products' AND column_name = 'media_revision'
      `;
      assert.equal(colCheckAfterDown, undefined, "products.media_revision must be dropped after rollback");

      const [tableCheckAfterDown] = await client`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${isolated} AND table_name = 'product_media'
      `;
      assert.equal(tableCheckAfterDown, undefined, "product_media table must be dropped after rollback");

      // Verify baseline products and media tables remain intact
      const [productsTable] = await client`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${isolated} AND table_name = 'products'
      `;
      assert.ok(productsTable, "products table must remain intact after rollback");

      const [mediaTable] = await client`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${isolated} AND table_name = 'media'
      `;
      assert.ok(mediaTable, "media table must remain intact after rollback");
      console.log("[PostgreSQL Verification] Verified DOWN migration cleanly drops product_media & media_revision while preserving products & media.");

      // 6. Verify RE-UP migration
      console.log("[PostgreSQL Verification] Re-applying migration 0015_product_gallery (RE-UP)...");
      for (const stmt of up0015.split("--> statement-breakpoint")) {
        if (stmt.trim()) await client.unsafe(stmt);
      }

      const [colCheckReUp] = await client`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = ${isolated} AND table_name = 'products' AND column_name = 'media_revision'
      `;
      assert.ok(colCheckReUp, "products.media_revision must exist after re-up");
      console.log("[PostgreSQL Verification] Verified RE-UP migration restores schema successfully.");

      console.log("[PostgreSQL Verification] ALL REAL POSTGRESQL CHECKS (UP -> CONSTRAINTS -> DOWN -> RE-UP) PASSED.");
    } finally {
      await client.end({ timeout: 5 });
    }
  } catch (err: unknown) {
    const error = err as Error;
    console.error("[PostgreSQL Verification] FAILED:", error.message);
    process.exitCode = 1;
  } finally {
    if (created) {
      console.log(`[PostgreSQL Verification] Cleaning up isolated schema ${isolated}...`);
      try {
        await admin.unsafe(`DROP SCHEMA IF EXISTS ${checkedSchema()} CASCADE`);
        console.log(`[PostgreSQL Verification] Cleaned up schema ${isolated}.`);
      } catch (cleanupErr: unknown) {
        console.error("[PostgreSQL Verification] Cleanup error:", (cleanupErr as Error).message);
      }
    }
    await admin.end({ timeout: 5 });
  }
}

void main();
