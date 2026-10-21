import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { DbContext } from "../../../../db/tx";
import * as schema from "../../../../db/schema";
import { postgresTestUrl } from "../../../../db";
import {
  deleteGalleryImage,
  getGalleryByProductId,
  getGalleryImageContent,
  resolveVariantImage,
  updateGallery,
} from "./gallery-service";

const isolated = `gallery_remove_${randomBytes(16).toString("hex")}`;
const url = postgresTestUrl();
const admin = postgres(url, { max: 1, onnotice: () => {} });
const options = { max: 1, onnotice: () => {}, connection: { search_path: isolated, statement_timeout: 10000 } };
const writer = postgres(url, { ...options, connection: { ...options.connection, application_name: isolated } });
const reader = postgres(url, { ...options, connection: { ...options.connection, application_name: `${isolated}_reader` } });
const db = drizzle(writer, { schema });
const readDb = drizzle(reader, { schema });

const testFilenames: string[] = [];

beforeAll(async () => {
  expect(isolated).toMatch(/^gallery_remove_[a-f0-9]{32}$/);
  await admin.unsafe(`CREATE SCHEMA "${isolated}"`);
  const journal = JSON.parse(await readFile("src/db/migrations/meta/_journal.json", "utf8"));
  for (const { tag } of journal.entries) {
    const ddl = (await readFile(`src/db/migrations/${tag}.sql`, "utf8")).replaceAll('"public".', `"${isolated}".`);
    for (const stmt of ddl.split("--> statement-breakpoint")) if (stmt.trim()) await writer.unsafe(stmt);
  }
  await mkdir(path.join(process.cwd(), "storage", "private"), { recursive: true });
});

afterAll(async () => {
  await Promise.all([writer.end(), reader.end()]);
  await admin.unsafe(`DROP SCHEMA IF EXISTS "${isolated}" CASCADE`);
  await admin.end();

  for (const filename of testFilenames) {
    try {
      await unlink(path.join(process.cwd(), "storage", "private", filename));
    } catch {
      // Ignore cleanup error if already removed
    }
  }
});

beforeEach(async () => {
  await writer.unsafe(`DROP TRIGGER IF EXISTS fail_audit ON audit_events; DROP TRIGGER IF EXISTS fail_remove ON product_media`);
  await writer`TRUNCATE audit_events`;
  await writer`DELETE FROM variant_media`;
  await writer`DELETE FROM product_media`;
  await writer`DELETE FROM variants`;
  await writer`DELETE FROM products`;
  await writer`DELETE FROM media`;

  await writer`INSERT INTO store_settings(id, store_name, support_email, support_phone, currency, currency_exponent) VALUES('default','Test','test@example.test','01000000000','USD',2) ON CONFLICT DO NOTHING`;
  await writer`INSERT INTO products(id, name, status, media_revision) VALUES('p', 'Remove gallery fixture', 'draft', 0)`;
  await writer`INSERT INTO variants(id, product_id, sku, combination_key, price_minor, currency, currency_scale, sort_order) VALUES('v1', 'p', 'ONE', 'size:s', 0, 'USD', 2, 0), ('v2', 'p', 'TWO', 'size:m', 0, 'USD', 2, 1)`;

  for (const [position, id] of ["a", "b", "c"].entries()) {
    const filename = `remove_test_${id}_${randomBytes(8).toString("hex")}.png`;
    testFilenames.push(filename);
    await writeFile(path.join(process.cwd(), "storage", "private", filename), Buffer.from(`fake-png-${id}`));

    await writer`INSERT INTO media(id, filename, mime_type, size, status) VALUES(${id}, ${filename}, 'image/png', 10, 'pending')`;
    await writer`INSERT INTO product_media(id, product_id, media_id, sort_order, alt_text) VALUES(${id}, 'p', ${id}, ${position}, ${'alt ' + id})`;
  }
});

async function state() {
  const gallery = await getGalleryByProductId(readDb, "p");
  const [audit] = await reader`SELECT count(*)::int AS count FROM audit_events WHERE resource='product:p'`;
  return { gallery, audits: audit.count };
}

const remove = (context: DbContext = db, imageId: string, expectedRevision = "0") =>
  deleteGalleryImage(context, {
    productId: "p",
    imageId,
    staffUserId: "staff-1",
    requestId: "remove-request",
    payload: { expectedRevision },
  });

describe("real PostgreSQL gallery image removal", () => {
  it("retains media row and physical bytes, sets removed_at, compacts positions and returns 404 for preview", async () => {
    // Delete middle image 'b'
    const result = await remove(db, "b", "0");

    expect(result.revision).toBe("1");
    expect(result.images.map(img => ({ id: img.id, position: img.position }))).toEqual([
      { id: "a", position: 0 },
      { id: "c", position: 1 },
    ]);
    expect(result.primaryImageId).toBe("a");

    // Verify product_media row has removed_at set
    const [removedRow] = await reader`SELECT id, product_id, media_id, removed_at FROM product_media WHERE id='b'`;
    expect(removedRow).toBeDefined();
    expect(removedRow.removed_at).not.toBeNull();

    // Verify media table row STILL exists (never physically deleted)
    const [mediaRow] = await reader`SELECT id, filename FROM media WHERE id='b'`;
    expect(mediaRow).toBeDefined();

    // Verify physical file on disk STILL exists
    const fileContent = await readFile(path.join(process.cwd(), "storage", "private", mediaRow.filename));
    expect(fileContent.toString()).toBe("fake-png-b");

    // Verify preview endpoint throws 404 for detached image immediately
    await expect(getGalleryImageContent(readDb, "p", "b")).rejects.toMatchObject({
      statusCode: 404,
    });

    // Verify preview for active image 'a' still works
    const activeContent = await getGalleryImageContent(readDb, "p", "a");
    expect(activeContent.buffer.toString()).toBe("fake-png-a");

    // Verify transactional audit event
    const audits = await reader`SELECT actor, action, resource, diff FROM audit_events WHERE resource='product:p'`;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor: "staff:staff-1",
      action: "catalog.product.image.detach",
      resource: "product:p",
      diff: {
        productMediaId: "b",
        mediaId: "b",
        sortOrder: 1,
        previousRevision: "0",
        mediaRevision: "1",
        clearedVariantImages: [],
      },
    });
  });

  it("compacts remaining active images in ascending sortOrder into contiguous 0-based slots", async () => {
    // Add two more images d (3) and e (4)
    for (const [offset, id] of ["d", "e"].entries()) {
      const filename = `remove_test_${id}_${randomBytes(8).toString("hex")}.png`;
      testFilenames.push(filename);
      await writeFile(path.join(process.cwd(), "storage", "private", filename), Buffer.from(`fake-png-${id}`));
      await writer`INSERT INTO media(id, filename, mime_type, size, status) VALUES(${id}, ${filename}, 'image/png', 10, 'pending')`;
      await writer`INSERT INTO product_media(id, product_id, media_id, sort_order, alt_text) VALUES(${id}, 'p', ${id}, ${3 + offset}, ${'alt ' + id})`;
    }

    // Gallery currently has a(0), b(1), c(2), d(3), e(4)
    // Remove primary image 'a'
    const step1 = await remove(db, "a", "0");
    expect(step1.revision).toBe("1");
    expect(step1.primaryImageId).toBe("b");
    expect(step1.images.map(img => [img.id, img.position])).toEqual([
      ["b", 0],
      ["c", 1],
      ["d", 2],
      ["e", 3],
    ]);

    // Remove middle image 'd' (which is at position 2)
    const step2 = await remove(db, "d", "1");
    expect(step2.revision).toBe("2");
    expect(step2.images.map(img => [img.id, img.position])).toEqual([
      ["b", 0],
      ["c", 1],
      ["e", 2],
    ]);

    // Check DB rows directly to verify unique index constraint compliance
    const activeRows = await reader`SELECT id, sort_order FROM product_media WHERE product_id='p' AND removed_at IS NULL ORDER BY sort_order ASC`;
    expect(activeRows.map(r => [r.id, r.sort_order])).toEqual([
      ["b", 0],
      ["c", 1],
      ["e", 2],
    ]);
  });

  it("clears variant mappings pointing to detached image and updates fallback to new primary", async () => {
    // Map v1 -> b, v2 -> b
    await writer`INSERT INTO variant_media(variant_id, product_id, product_media_id) VALUES('v1', 'p', 'b'), ('v2', 'p', 'b')`;

    const beforeState = await state();
    expect(beforeState.gallery.variantImages).toEqual([
      { variantId: "v1", imageId: "b" },
      { variantId: "v2", imageId: "b" },
    ]);

    // Detach image 'b'
    const result = await remove(db, "b", "0");
    expect(result.revision).toBe("1");
    expect(result.variantImages).toEqual([]);

    // DB verification
    const mappings = await reader`SELECT * FROM variant_media WHERE product_id='p'`;
    expect(mappings).toHaveLength(0);

    // Unassigned variants fallback to primary image 'a'
    const v1Resolved = resolveVariantImage(result, "v1");
    expect(v1Resolved?.id).toBe("a");
    const v2Resolved = resolveVariantImage(result, "v2");
    expect(v2Resolved?.id).toBe("a");

    // Audit log records the cleared variant images
    const [audit] = await reader`SELECT diff FROM audit_events WHERE resource='product:p'`;
    expect(audit.diff.clearedVariantImages).toEqual([
      { variantId: "v1", imageId: "b" },
      { variantId: "v2", imageId: "b" },
    ]);
  });

  it("removes last image, leaving empty gallery with primaryImageId null and cleared variant mappings", async () => {
    // Delete 'b' and 'c' first
    await remove(db, "b", "0");
    await remove(db, "c", "1");

    // Map variant v1 to 'a'
    await writer`INSERT INTO variant_media(variant_id, product_id, product_media_id) VALUES('v1', 'p', 'a')`;

    // Now remove the last remaining image 'a'
    const result = await remove(db, "a", "2");
    expect(result.revision).toBe("3");
    expect(result.images).toEqual([]);
    expect(result.primaryImageId).toBeNull();
    expect(result.variantImages).toEqual([]);

    // Variant fallback is null when no images exist
    const v1Resolved = resolveVariantImage(result, "v1");
    expect(v1Resolved).toBeNull();
  });

  it("serializes competing independent connections with revision guard (one commits, other gets STALE_GALLERY)", async () => {
    // Both writer and reader try to remove with expectedRevision "0"
    const first = remove(db, "b", "0");
    const competitor = remove(readDb, "c", "0");

    const results = await Promise.allSettled([first, competitor]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(r => r.status === "rejected");
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: "STALE_GALLERY",
      statusCode: 409,
    });

    const currentState = await state();
    expect(currentState.audits).toBe(1);
    expect(currentState.gallery.revision).toBe("1");
  });

  it("serializes competing delete versus reorder connections", async () => {
    const reorderPayload = {
      expectedRevision: "0",
      images: [
        { id: "c", altText: "c" },
        { id: "b", altText: "b" },
        { id: "a", altText: "a" },
      ],
      variantImages: [],
    };

    const first = remove(db, "b", "0");
    const competitor = updateGallery(readDb, {
      productId: "p",
      staffUserId: "staff-2",
      requestId: "competing-reorder",
      payload: reorderPayload,
    });

    const results = await Promise.allSettled([first, competitor]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(r => r.status === "rejected");
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: "STALE_GALLERY",
      statusCode: 409,
    });

    const currentState = await state();
    expect(currentState.audits).toBe(1);
    expect(currentState.gallery.revision).toBe("1");
  });

  it("rolls back soft-delete, mapping cleanup, position compaction, and revision on audit failure", async () => {
    // Map v1 -> b
    await writer`INSERT INTO variant_media(variant_id, product_id, product_media_id) VALUES('v1', 'p', 'b')`;

    const before = await state();

    // Inject trigger failure on audit_events
    await writer.unsafe(`
      CREATE OR REPLACE FUNCTION fail_remove_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected remove audit failure';
      END;
      $$;
      CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_remove_audit_fn();
    `);

    await expect(remove(db, "b", "0")).rejects.toThrow();

    // Verify complete rollback
    const after = await state();
    expect(after).toEqual(before);

    // Verify row was not soft-deleted
    const [pmRow] = await reader`SELECT removed_at FROM product_media WHERE id='b'`;
    expect(pmRow.removed_at).toBeNull();

    // Verify variant mapping still exists
    const [vmRow] = await reader`SELECT * FROM variant_media WHERE product_media_id='b'`;
    expect(vmRow).toBeDefined();
  });

  it("rejects removal on non-draft product with 409 CONFLICT without mutation", async () => {
    await writer`UPDATE products SET status='published' WHERE id='p'`;
    const before = await state();

    await expect(remove(db, "b", "0")).rejects.toMatchObject({
      statusCode: 409,
    });

    const after = await state();
    expect(after.gallery.revision).toBe(before.gallery.revision);
    expect(after.audits).toBe(before.audits);
  });

  it("rejects removal of already soft-deleted image with 404 NOT_FOUND", async () => {
    // Delete 'b' first
    await remove(db, "b", "0");

    // Attempting to delete 'b' again returns 404
    await expect(remove(db, "b", "1")).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
