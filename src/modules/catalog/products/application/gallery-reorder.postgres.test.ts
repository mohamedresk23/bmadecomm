import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { asc, eq } from "drizzle-orm";
import type { DbContext } from "../../../../db/tx";
import * as schema from "../../../../db/schema";
import { postgresTestUrl } from "../../../../db";
import { getGalleryByProductId, updateGallery } from "./gallery-service";

const isolated = `gallery_reorder_${randomBytes(16).toString("hex")}`;
const url = postgresTestUrl();
const admin = postgres(url, { max: 1, onnotice: () => {} });
const options = { max: 1, onnotice: () => {}, connection: { search_path: isolated, statement_timeout: 10000 } };
const writer = postgres(url, { ...options, connection: { ...options.connection, application_name: isolated } });
const reader = postgres(url, options);
const db = drizzle(writer, { schema });
const readDb = drizzle(reader, { schema });
const images = (ids = ["b", "a", "c"]) => ids.map(id => ({ id, altText: `edited ${id}` }));
const save = (ids?: string[]) => updateGallery(db, { productId: "p", staffUserId: "staff", requestId: "reorder-test", payload: { expectedRevision: "0", images: images(ids), variantImages: [] } });

beforeAll(async () => {
  expect(isolated).toMatch(/^gallery_reorder_[a-f0-9]{32}$/);
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
  await writer`DELETE FROM product_media`;
  await writer`DELETE FROM products`;
  await writer`DELETE FROM media`;
  await writer`INSERT INTO products(id,name,status) VALUES('p','Reorder fixture','draft')`;
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

describe("real PostgreSQL gallery reordering", () => {
  it.each(["single-statement", "legacy-two-statement"])("controlled read/commit interleaving detects mixed snapshots: %s", async implementation => {
    const before = { revision: "0", ids: ["a", "b", "c"] };
    const interleaved = commitAfterFirstStatement(readDb, () => save());
    let observed: { revision: string; ids: string[] };
    if (implementation === "single-statement") {
      const gallery = await getGalleryByProductId(interleaved, "p");
      observed = { revision: gallery.revision, ids: gallery.images.map(image => image.id) };
      expect(observed).toEqual(before);
    } else {
      // Deliberate reproduction of the pre-fix read algorithm proves this
      // schedule would reject it, rather than merely pausing an uncommitted writer.
      const [product] = await interleaved.select({ revision: schema.products.mediaRevision }).from(schema.products).where(eq(schema.products.id, "p"));
      const rows = await interleaved.select({ id: schema.productMedia.id }).from(schema.productMedia).where(eq(schema.productMedia.productId, "p")).orderBy(asc(schema.productMedia.sortOrder));
      observed = { revision: product.revision.toString(), ids: rows.map(row => row.id) };
      expect(observed).toEqual({ revision: "0", ids: ["b", "a", "c"] });
      expect(observed).not.toEqual(before);
    }
    const after = await getGalleryByProductId(readDb, "p");
    expect(after.revision).toBe("1");
    expect(after.images.map(image => image.id)).toEqual(["b", "a", "c"]);
  });
  it("swaps and cycles with descriptions, contiguous positions, one revision/audit and no-op", async () => {
    const result = await save(["c", "a", "b"]);
    expect(result.images.map(i => [i.id,i.position,i.altText])).toEqual([["c",0,"edited c"],["a",1,"edited a"],["b",2,"edited b"]]);
    expect(result.primaryImageId).toBe("c");
    expect((await state()).audits).toBe(1);
    const unchanged = await updateGallery(db, { productId: "p", staffUserId: "staff", requestId: "noop", payload: { expectedRevision: "1", images: images(["c", "a", "b"]), variantImages: [] } });
    expect(unchanged.revision).toBe("1"); expect((await state()).audits).toBe(1);
  });
  it("avoids occupied fixed offsets and integer overflow", async () => {
    await writer`UPDATE product_media SET sort_order=10000 WHERE id='b'`;
    await writer`UPDATE product_media SET sort_order=2147483647 WHERE id='c'`;
    expect((await save()).images.map(i => i.position)).toEqual([0,1,2]);
  });
  it("serializes competing independent connections with one stale rejection", async () => {
    const other = updateGallery(readDb, { productId: "p", staffUserId: "staff", requestId: "competitor", payload: { expectedRevision: "0", images: images(["c", "b", "a"]), variantImages: [] } });
    const results = await Promise.allSettled([save(), other]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "STALE_GALLERY" } });
    expect((await state()).audits).toBe(1); expect((await state()).gallery.revision).toBe("1");
  });
  it.each(["temporary", "final", "audit"])("rolls back descriptions/order/revision/audit on %s failure", async phase => {
    const before = await state();
    const condition = phase === "temporary" ? "NEW.sort_order >= 3 AND NEW.id='a'" : "NEW.sort_order < 3 AND NEW.id='a'";
    await writer.unsafe(`CREATE OR REPLACE FUNCTION fail_reorder_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${phase === "audit" ? "true" : condition} THEN RAISE EXCEPTION 'injected reorder failure'; END IF; RETURN NEW; END $$`);
    await writer.unsafe(phase === "audit" ? `CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_reorder_fn()` : `CREATE TRIGGER fail_reorder BEFORE UPDATE ON product_media FOR EACH ROW EXECUTE FUNCTION fail_reorder_fn()`);
    await expect(save()).rejects.toThrow();
    expect(await state()).toEqual(before);
  });
  it("reads the complete old aggregate while writer pauses mid-reorder then the complete new aggregate", async () => {
    const before = await getGalleryByProductId(readDb, "p");
    // Reader owns a session advisory gate; the writer's trigger waits on it.
    await reader`SELECT pg_advisory_lock(430305)`;
    await writer.unsafe(`CREATE OR REPLACE FUNCTION pause_reorder_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='a' AND NEW.sort_order>=3 THEN PERFORM pg_advisory_xact_lock(430305); END IF; RETURN NEW; END $$`);
    await writer.unsafe(`CREATE TRIGGER pause_reorder BEFORE UPDATE ON product_media FOR EACH ROW EXECUTE FUNCTION pause_reorder_fn()`);
    const pending = save();
    try {
      let observed = false;
      for (let attempt=0; attempt<100; attempt++) {
        const [row] = await reader`SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=${isolated} AND wait_event='advisory'`;
        if (row.count) { observed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(observed).toBe(true);
      expect(await getGalleryByProductId(readDb, "p")).toEqual(before);
    } finally { await reader`SELECT pg_advisory_unlock(430305)`; }
    const committed = await pending;
    expect(await getGalleryByProductId(readDb, "p")).toEqual(committed);
    await expect(getGalleryByProductId(readDb, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
