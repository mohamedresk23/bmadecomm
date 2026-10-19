import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { DbContext } from "../../../../db/tx";
import * as schema from "../../../../db/schema";
import { postgresTestUrl } from "../../../../db";
import { getGalleryByProductId, updateGallery } from "./gallery-service";
import { updateProduct } from "./product-service";

const isolated = `variant_images_${randomBytes(16).toString("hex")}`;
const url = postgresTestUrl();
const admin = postgres(url, { max: 1, onnotice: () => {} });
const options = { max: 1, onnotice: () => {}, connection: { search_path: isolated, statement_timeout: 10000 } };
const writer = postgres(url, { ...options, connection: { ...options.connection, application_name: isolated } });
const reader = postgres(url, { ...options, connection: { ...options.connection, application_name: `${isolated}_competitor` } });
const db = drizzle(writer, { schema });
const readDb = drizzle(reader, { schema });

beforeAll(async () => {
  expect(isolated).toMatch(/^variant_images_[a-f0-9]{32}$/);
  await admin.unsafe(`CREATE SCHEMA "${isolated}"`);
  const journal = JSON.parse(await readFile("src/db/migrations/meta/_journal.json", "utf8"));
  for (const { tag } of journal.entries) {
    const ddl = (await readFile(`src/db/migrations/${tag}.sql`, "utf8")).replaceAll('"public".', `"${isolated}".`);
    for (const stmt of ddl.split("--> statement-breakpoint")) if (stmt.trim()) await writer.unsafe(stmt);
  }
});
afterAll(async () => {
  await Promise.all([writer.end(), reader.end()]);
  await admin.unsafe(`DROP SCHEMA IF EXISTS "${isolated}" CASCADE`);
  await admin.end();
});
beforeEach(async () => {
  await writer.unsafe(`DROP TRIGGER IF EXISTS fail_reorder ON product_media; DROP TRIGGER IF EXISTS fail_audit ON audit_events; DROP TRIGGER IF EXISTS pause_reorder ON product_media`);
  // Only this randomly named disposable schema; preserve the append-only trigger.
  await writer`TRUNCATE audit_events`;
  await writer`DELETE FROM variant_media`;
  await writer`DELETE FROM product_media`;
  await writer`DELETE FROM products`;
  await writer`DELETE FROM media`;
  await writer`INSERT INTO store_settings(id, store_name, support_email, support_phone, currency, currency_exponent) VALUES('default','Test','test@example.test','01000000000','USD',2) ON CONFLICT DO NOTHING`;
  await writer`INSERT INTO categories(id, name, slug) VALUES('cat','Test','test') ON CONFLICT DO NOTHING`;
  await writer`INSERT INTO products(id,name,status) VALUES('p','Reorder fixture','draft')`;
  await writer`INSERT INTO variants(id,product_id,sku,combination_key,price_minor,currency,currency_scale,sort_order) VALUES('v1','p','ONE','size:s',0,'USD',2,0),('v2','p','TWO','size:m',0,'USD',2,1)`;
  await writer`INSERT INTO product_categories(product_id,category_id) VALUES('p','cat')`;
  for (const [position,id] of ["a", "b", "c"].entries()) {
    await writer`INSERT INTO media(id,filename,mime_type,size,status) VALUES(${id},${id + '.png'},'image/png',10,'pending')`;
    await writer`INSERT INTO product_media(id,product_id,media_id,sort_order,alt_text) VALUES(${id},'p',${id},${position},${id})`;
  }
});
async function state() {
  const gallery = await getGalleryByProductId(readDb, "p");
  const [audit] = await reader`SELECT count(*)::int AS count FROM audit_events WHERE resource='product:p'`;
  return { gallery, audits: audit.count };
}

// Deliver the first SQL result, then commit a writer before allowing the
// application to issue another statement. A joined read keeps its old snapshot;
// the former revision-then-images implementation necessarily mixes versions.
function commitAfterFirstStatement(context: DbContext, commit: () => Promise<unknown>): DbContext {
  let committed = false;
  const wrap = (builder: object): object => new Proxy(builder, {
    get(target, property) {
      if (property === "then") return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(target).then(async result => {
          if (!committed) { committed = true; await commit(); }
          return result;
        }).then(resolve, reject);
      const value = Reflect.get(target, property);
      return typeof value === "function" ? (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args);
        return result && typeof result === "object" ? wrap(result) : result;
      } : value;
    },
  });
  return new Proxy(context, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property === "select") return (...args: unknown[]) => wrap(Reflect.apply(value, target, args));
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}


const mappedPayload = { expectedRevision: "0", images: ["a", "b", "c"].map(id => ({ id, altText: id })), variantImages: [{ variantId: "v1", imageId: "b" }, { variantId: "v2", imageId: "b" }] };
const map = (context: DbContext = db, payload = mappedPayload) => updateGallery(context, { productId: "p", staffUserId: "staff", requestId: "mapping", payload });
const edit = (context: DbContext = db, retainBoth = true) => updateProduct(context, "p", { name: "Edited", categoryIds: ["cat"], variants: [{ id: "v1", sku: "TWO", priceMinor: "0", attributes: { size: "xs" } }, ...(retainBoth ? [{ id: "v2", sku: "ONE", priceMinor: "0", attributes: { size: "l" } }] : [])] }, "staff", "edit");

describe("real PostgreSQL variant mapping", () => {
  it("migrates down and reapplies without changing retained product, variants or media", async () => {
    await map();
    const before = await reader`SELECT id,sku FROM variants ORDER BY id`;
    await writer.unsafe(await readFile("src/db/migrations/0017_variant_media.down.sql", "utf8"));
    expect(await reader`SELECT id,sku FROM variants ORDER BY id`).toEqual(before);
    const up = await readFile("src/db/migrations/0017_variant_media.sql", "utf8");
    for (const statement of up.split("--> statement-breakpoint")) if (statement.trim()) await writer.unsafe(statement);
    expect((await state()).gallery.variantImages).toEqual([]);
    expect(await reader`SELECT id FROM media`).toHaveLength(3);
    expect(await reader`SELECT id FROM products`).toHaveLength(1);
    await map(db, { ...mappedPayload, expectedRevision: "1" });
  });
  it("rejects cross-product FKs and restrictive variant/attachment deletion", async () => {
    await map();
    await writer`INSERT INTO products(id,name) VALUES('foreign','Foreign')`;
    for (const statement of ["INSERT INTO variant_media VALUES('missing','p','b')", "INSERT INTO variant_media VALUES('v1','foreign','b')", "DELETE FROM variants WHERE id='v1'", "DELETE FROM product_media WHERE id='b'"]) await expect(writer.unsafe(statement)).rejects.toThrow();
    expect((await state()).gallery.variantImages).toHaveLength(2);
  });
  it("rejects missing, foreign, removed and duplicate references without changing aggregate/audit", async () => {
    await writer`INSERT INTO products(id,name) VALUES('foreign','Foreign')`;
    await writer`INSERT INTO variants(id,product_id,sku,combination_key,price_minor,currency,currency_scale,sort_order) VALUES('foreign-v','foreign','FOREIGN','',0,'USD',2,0)`;
    await writer`INSERT INTO media(id,filename,mime_type,size,status) VALUES('removed-m','removed.png','image/png',10,'pending')`;
    await writer`INSERT INTO product_media(id,product_id,media_id,sort_order,alt_text,removed_at) VALUES('removed','p','removed-m',10,'Removed',now())`;
    await writer`INSERT INTO product_media(id,product_id,media_id,sort_order,alt_text) VALUES('foreign-i','foreign','a',0,'Foreign')`;
    const before = await state();
    for (const variantImages of [[{ variantId: "missing", imageId: "b" }], [{ variantId: "foreign-v", imageId: "b" }], [{ variantId: "v1", imageId: "missing" }], [{ variantId: "v1", imageId: "removed" }], [{ variantId: "v1", imageId: "foreign-i" }], [{ variantId: "v1", imageId: "b" }, { variantId: "v1", imageId: "c" }]]) {
      await expect(map(db, { ...mappedPayload, variantImages })).rejects.toMatchObject({ statusCode: 422 });
      expect(await state()).toEqual(before);
    }
  });
  it("preserves mapping through SKU swap and clears genuinely removed IDs once", async () => {
    await map(); await edit();
    expect((await state()).gallery).toMatchObject({ revision: "1", variantImages: mappedPayload.variantImages });
    await edit(db, false);
    expect((await state()).gallery).toMatchObject({ revision: "2", variantImages: [mappedPayload.variantImages[0]] });
    expect((await state()).audits).toBe(3);
  });
  it("rolls back replacement, mapping, revision and audit on audit failure", async () => {
    await map(); const before = await state();
    await writer.unsafe(`CREATE OR REPLACE FUNCTION fail_variant_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$; CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_variant_audit_fn()`);
    await expect(edit(db, false)).rejects.toThrow(); expect(await state()).toEqual(before);
    await expect(map(db, { ...mappedPayload, expectedRevision: "1", variantImages: [] })).rejects.toThrow(); expect(await state()).toEqual(before);
  });
  it.each(["gallery-first", "replacement-first"])("serializes independent replacement versus mapping connections: %s", async first => {
    await map();
    const payload = { ...mappedPayload, expectedRevision: "1", variantImages: [{ variantId: "v2", imageId: "c" }] };
    // Hold the canonical product lock in one connection, start its command,
    // then queue the competing command on another connection before releasing.
    let announce!: () => void, release!: () => void;
    const locked = new Promise<void>(resolve => { announce = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const firstWrite = db.transaction(async tx => {
      await tx.execute((await import("drizzle-orm")).sql`SELECT id FROM products WHERE id='p' FOR UPDATE`);
      announce(); await gate;
      return first === "gallery-first" ? map(tx, payload) : edit(tx, false);
    });
    await locked;
    const secondWrite = first === "gallery-first" ? edit(readDb, false) : map(readDb, payload);
    const pendingResults = Promise.allSettled([firstWrite, secondWrite]);
    let overlapping = false;
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        const [waiting] = await admin`SELECT count(*)::int AS count FROM pg_stat_activity competing
          WHERE competing.application_name=${`${isolated}_competitor`} AND competing.wait_event_type='Lock'
          AND EXISTS (SELECT 1 FROM pg_stat_activity holding WHERE holding.application_name=${isolated} AND holding.pid=ANY(pg_blocking_pids(competing.pid)))`;
        if (waiting.count) { overlapping = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } finally { release(); }
    const results = await pendingResults;
    expect(overlapping, "Independent competing command reached the product lock before release").toBe(true);
    expect(results[0].status).toBe("fulfilled");
    if (first === "replacement-first") expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "STALE_GALLERY" } });
    else expect(results[1].status).toBe("fulfilled");
    const after = await state(); expect(after.gallery.variantImages.every(mapping => mapping.variantId === "v1")).toBe(true);
    expect(after.gallery.revision).toBe(first === "gallery-first" ? "3" : "2");
  });
  it("reads mappings, revision and images in one consistent statement snapshot", async () => {
    const observed = await getGalleryByProductId(commitAfterFirstStatement(readDb, () => map()), "p");
    expect(observed).toMatchObject({ revision: "0", variantImages: [] });
    expect((await state()).gallery).toMatchObject({ revision: "1", variantImages: mappedPayload.variantImages });
  });
});
