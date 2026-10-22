import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../../../../db/schema";
import { postgresTestUrl } from "../../../../db";
import { seedPublication } from "../../../../test-utils/publication";
import { publishProduct, unpublishProduct } from "./publication-service";
import { getProductById, updateProduct } from "./product-service";
import { updateGallery } from "./gallery-service";
import { setupIsolatedPublicationStorage } from "../../../../test-utils/publication-storage";

setupIsolatedPublicationStorage();

const isolated = `publication_${randomBytes(16).toString("hex")}`;
const url = postgresTestUrl();
const admin = postgres(url, { max: 1, onnotice: () => {} });
const options = { max: 1, onnotice: () => {}, connection: { search_path: isolated, statement_timeout: 10000 } };
const writer = postgres(url, options);
const reader = postgres(url, { ...options, connection: { ...options.connection, application_name: isolated } });
const db = drizzle(writer, { schema });
const other = drizzle(reader, { schema });
beforeAll(async () => {
  expect(isolated).toMatch(/^publication_[a-f0-9]{32}$/);
  await admin.unsafe(`CREATE SCHEMA "${isolated}"`);
  const journal = JSON.parse(await readFile("src/db/migrations/meta/_journal.json", "utf8"));
  for (const { tag } of journal.entries) {
    const ddl = (await readFile(`src/db/migrations/${tag}.sql`, "utf8")).replaceAll('"public".', `"${isolated}".`);
    for (const statement of ddl.split("--> statement-breakpoint")) if (statement.trim()) await writer.unsafe(statement);
  }
});
afterAll(async () => {
  await Promise.all([writer.end(), reader.end()]);
  await admin.unsafe(`DROP SCHEMA IF EXISTS "${isolated}" CASCADE`);
  await admin.end();
});
beforeEach(async () => {
  await writer.unsafe("DROP TRIGGER IF EXISTS fail_publication_audit ON audit_events");
  await writer`TRUNCATE audit_events`;
  await writer`DELETE FROM products`;
  await writer`DELETE FROM media`;
  await writer`DELETE FROM categories`;
  await seedPublication(db, "p");
  await db.insert(schema.storeSettings).values({ id: "default", storeName: "Test", supportEmail: "test@example.test", supportPhone: "01000000000" }).onConflictDoNothing();
});
async function waitForLock() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [row] = await admin`SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=${isolated} AND wait_event_type='Lock'`;
    if (row.count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Competing command did not wait for the aggregate lock");
}
const auditCount = async () => (await writer`SELECT count(*)::int AS count FROM audit_events WHERE action IN ('product.publish','product.unpublish')`)[0].count;
describe("real PostgreSQL publication serialization", () => {
  it("serializes concurrent publish and unpublish commands without duplicate audits", async () => {
    const results = await Promise.all([publishProduct(db, "p", "actor"), publishProduct(other, "p", "actor")]);
    expect(results[0]).toEqual(results[1]); expect(await auditCount()).toBe(1);
    const drafts = await Promise.all([unpublishProduct(db, "p", "actor"), unpublishProduct(other, "p", "actor")]);
    expect(drafts[0]).toEqual(drafts[1]); expect(await auditCount()).toBe(2);
    expect(drafts[0].publishedAt).toBe(results[0].publishedAt);
  });
  it("orders opposing commands by the aggregate lock", async () => {
    let pending!: ReturnType<typeof unpublishProduct>;
    let publishedAt: string | null = null;
    await db.transaction(async tx => {
      publishedAt = (await publishProduct(tx, "p", "actor")).publishedAt;
      pending = unpublishProduct(other, "p", "actor");
      void pending.catch(() => {});
      await waitForLock();
    });
    expect(await pending).toMatchObject({ status: "draft", publishedAt });
    expect(await auditCount()).toBe(2);
  });
  it.each(["product", "gallery"])("rechecks committed %s edits after waiting for their parent lock", async kind => {
    let pending!: Promise<unknown>;
    await db.transaction(async tx => {
      await tx.select().from(schema.products).where(eq(schema.products.id, "p")).for("update");
      const product = await getProductById(tx, "p");
      if (kind === "product") await updateProduct(tx, "p", { name: product.name, description: null, categoryIds: product.categoryIds, variants: product.variants.map(({ id, sku, priceMinor, comparePriceMinor, attributes }) => ({ id, sku, priceMinor, comparePriceMinor, attributes })) }, "editor");
      else await updateGallery(tx, { productId: "p", staffUserId: "editor", requestId: "edit", payload: { expectedRevision: "0", images: [{ id: "p-i", altText: "" }], variantImages: [] } });
      pending = publishProduct(other, "p", "actor");
      // Attach rejection handling before releasing the lock.
      void pending.catch(() => {});
      await waitForLock();
    });
    await expect(pending).rejects.toMatchObject({ code: "PUBLICATION_READINESS_FAILED" });
    expect((await getProductById(db, "p")).status).toBe("draft"); expect(await auditCount()).toBe(0);
  });
  it("makes a waiting gallery writer observe published status and retain Draft-only rules", async () => {
    let pending!: Promise<unknown>;
    await db.transaction(async tx => {
      await publishProduct(tx, "p", "actor");
      pending = updateGallery(other, { productId: "p", staffUserId: "editor", requestId: "edit", payload: { expectedRevision: "0", images: [{ id: "p-i", altText: "Changed" }], variantImages: [] } });
      void pending.catch(() => {});
      await waitForLock();
    });
    await expect(pending).rejects.toMatchObject({ statusCode: 409 });
    expect((await db.select().from(schema.productMedia))[0].altText).toBe("Product image");
    expect(await auditCount()).toBe(1);
  });
  it("publishes restored committed facts after a locked editor rolls back", async () => {
    let pending!: ReturnType<typeof publishProduct>;
    const rollback = new Error("controlled editor rollback");
    await expect(db.transaction(async tx => {
      await tx.select().from(schema.products).where(eq(schema.products.id, "p")).for("update");
      await tx.update(schema.products).set({ description: null }).where(eq(schema.products.id, "p"));
      pending = publishProduct(other, "p", "actor", "after-rollback");
      void pending.catch(() => {});
      await waitForLock();
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await pending).toMatchObject({ status: "published", description: "Details" });
    expect(await auditCount()).toBe(1);
    expect((await getProductById(db, "p")).status).toBe("published");
  });
  it.each(["publish", "unpublish"])("rolls back %s status and timestamps when the database rejects audit", async command => {
    if (command === "unpublish") await publishProduct(db, "p", "actor");
    const before = await getProductById(db, "p"); const count = await auditCount();
    await writer.unsafe("CREATE OR REPLACE FUNCTION fail_publication_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$");
    await writer.unsafe("CREATE TRIGGER fail_publication_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_publication_audit_fn()");
    await expect((command === "publish" ? publishProduct : unpublishProduct)(db, "p", "actor")).rejects.toThrow();
    expect(await getProductById(db, "p")).toEqual(before); expect(await auditCount()).toBe(count);
  });
});
