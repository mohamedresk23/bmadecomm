import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { setupTestDb, withIsolatedTx } from "../../test-utils/db";
import { seedPublication } from "../../test-utils/publication";
import { auditEvents, media, productMedia, products, storeSettings } from "../../db/schema";
import { LocalFileSystemAdapter, storage } from "./storage";
import { reconcileCatalogPublicCopies } from "./catalog-public-copies";
import { publishProduct, unpublishProduct } from "../../modules/catalog/products/application/publication-service";
import { runCatalogReconciliation } from "../../../scripts/reconcile-catalog-public-media";
import * as audit from "../../shared/authz/audit";

let root: string;
let adapter: LocalFileSystemAdapter;
beforeAll(setupTestDb);
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-privacy-"));
  adapter = new LocalFileSystemAdapter(root);
  for (const method of ["inspectPublic", "quarantinePublic"] as const) vi.spyOn(storage, method).mockImplementation(adapter[method].bind(adapter));
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe fixture root");
  await fs.rm(root, { recursive: true, force: true });
});
async function legacy(key = "private.png") {
  await adapter.savePrivate(key, Buffer.from("original"));
  await adapter.publish(key);
  await fs.writeFile(path.join(root, "public/uploads", key), "divergent legacy");
}
describe("catalog public copy reconciliation", () => {
  it("preserves divergent exact bytes and history on unpublish, including draft no-ops and removed shared links", async () => {
    await withIsolatedTx(async tx => {
      const id = await seedPublication(tx);
      await legacy();
      await tx.insert(products).values({id:"shared",name:"Shared",status:"archived"});
      await tx.insert(productMedia).values({id:"removed",productId:"shared",mediaId:`${id}-m`,sortOrder:0,removedAt:new Date()});
      await publishProduct(tx,id,"staff");
      const history = await tx.select().from(productMedia);
      const result = await unpublishProduct(tx,id,"staff");
      expect(result.status).toBe("draft");
      expect(await adapter.inspectPublic("private.png")).toBeNull();
      const log = JSON.parse((await fs.readFile(path.join(root,"storage/catalog-quarantine/preservation.jsonl"),"utf8")).trim());
      expect((await fs.readFile(path.join(root,log.recoveryPath))).toString()).toBe("divergent legacy");
      expect((await adapter.readPrivate("private.png")).toString()).toBe("original");
      expect(await tx.select().from(productMedia)).toEqual(history);
      const before = await tx.select().from(products);
      const events = await tx.select().from(auditEvents);
      await adapter.publish("private.png");
      await unpublishProduct(tx,id,"staff");
      await unpublishProduct(tx,id,"staff");
      expect(await adapter.inspectPublic("private.png")).toBeNull();
      expect(await tx.select().from(products)).toEqual(before);
      expect(await tx.select().from(auditEvents)).toEqual(events);
    });
  });
  it("keeps transition and audit unchanged on failure and permits a preservation-first retry", async () => {
    await withIsolatedTx(async tx => {
      const id = await seedPublication(tx); await publishProduct(tx,id,"staff"); await legacy();
      const before = await tx.select().from(products); const events = await tx.select().from(auditEvents);
      const spy = vi.spyOn(adapter,"removePublic").mockRejectedValueOnce(new Error("disk failure"));
      await expect(unpublishProduct(tx,id,"staff")).rejects.toMatchObject({statusCode:503});
      expect(await tx.select().from(products)).toEqual(before); expect(await tx.select().from(auditEvents)).toEqual(events);
      expect(await adapter.inspectPublic("private.png")).not.toBeNull();
      spy.mockRestore();
      expect((await unpublishProduct(tx,id,"staff")).status).toBe("draft");
      expect(await adapter.inspectPublic("private.png")).toBeNull();
    });
  });
  it.each(["unrelated", "logo"])("blocks shared %s keys and reports command failure without removing bytes", async conflict => {
    await withIsolatedTx(async tx => {
      const id = await seedPublication(tx); await legacy();
      if(conflict === "unrelated") await tx.insert(media).values({id:"alias",filename:"PRIVATE.PNG",mimeType:"image/png",size:3,status:"active"});
      else await tx.update(storeSettings).set({logoMediaId:`${id}-m`}).where(eq(storeSettings.id,"default"));
      const output: string[] = [];
      expect(await runCatalogReconciliation(tx,["--storage-root",root,"--apply"], value => output.push(value))).toBe(1);
      expect(JSON.parse(output[0]).results).toMatchObject([{state:"conflict"}]);
      await expect(unpublishProduct(tx,id,"staff")).rejects.toMatchObject({statusCode:409});
      expect(await adapter.inspectPublic("private.png")).not.toBeNull();
    });
  });
  it.each(["draft", "published", "archived"])("inventories %s products by default; apply deduplicates historical keys and preserves unrelated media", async status => {
    await withIsolatedTx(async tx => {
      const id = await seedPublication(tx); await legacy();
      await tx.update(products).set({status}).where(eq(products.id,id));
      await tx.update(productMedia).set({removedAt:new Date()}).where(eq(productMedia.productId,id));
      await tx.insert(products).values({id:"second-product",name:"Historical",status:"archived"});
      await tx.insert(productMedia).values({id:"second",productId:"second-product",mediaId:`${id}-m`,sortOrder:1,removedAt:new Date()});
      await tx.insert(media).values({id:"logo",filename:"logo.png",mimeType:"image/png",size:4,status:"active"});
      await tx.update(storeSettings).set({logoMediaId:"logo"}).where(eq(storeSettings.id,"default"));
      await adapter.savePrivate("logo.png",Buffer.from("logo")); await adapter.publish("logo.png");
      const output: string[] = [];
      expect(await runCatalogReconciliation(tx,["--storage-root",root], value => output.push(value))).toBe(0);
      expect(JSON.parse(output[0]).results).toMatchObject([{state:"exposed"}]);
      expect(await adapter.inspectPublic("private.png")).not.toBeNull();
      expect(await runCatalogReconciliation(tx,["--storage-root",root,"--apply"],()=>{})).toBe(0);
      expect(await reconcileCatalogPublicCopies(tx,{apply:true,adapter})).toMatchObject([{state:"absent"}]);
      expect((await fs.readFile(path.join(root,"public/uploads/logo.png"))).toString()).toBe("logo");
    });
  });
  it("bounds storage keys and refuses traversal", async () => {
    await expect(adapter.quarantinePublic("../private.png")).rejects.toThrow("Invalid media key");
    await expect(adapter.inspectPublic("a".repeat(256)+".png")).rejects.toThrow("Invalid media key");
  });
  it.each([[], ["--apply"], ["--storage-root","relative"], ["--storage-root","--apply"], ["--storage-root","unused","--unknown"]].map(args => ({args})))("rejects invalid operator arguments $args before accessing catalog storage", async ({args}) => {
    await withIsolatedTx(async tx => {
      await expect(runCatalogReconciliation(tx,args,()=>{})).rejects.toThrow();
      expect(storage.inspectPublic).not.toHaveBeenCalled();
    });
  });
  it.each([false,true].flatMap(apply => [false,true].map(missing => ({apply,missing}))))("rejects invalid deployment root before inventory (apply=$apply, missing=$missing)", async ({apply,missing}) => {
    await withIsolatedTx(async tx => {
      const select=vi.spyOn(tx,"select");
      const inspect=vi.spyOn(LocalFileSystemAdapter.prototype,"inspectPublic");
      await expect(runCatalogReconciliation(tx,["--storage-root",missing ? path.join(root,"nonexistent") : root,...(apply ? ["--apply"] : [])],()=>{})).rejects.toThrow();
      expect(select).not.toHaveBeenCalled(); expect(inspect).not.toHaveBeenCalled();
    });
  });
  it("rejects corrupt pre-existing recovery bytes without withdrawing public bytes or committing unpublication", async () => {
    await withIsolatedTx(async tx => {
      const id=await seedPublication(tx); await publishProduct(tx,id,"staff"); await legacy();
      const publicBytes=Buffer.from("divergent legacy");
      const digest=createHash("sha256").update(publicBytes).digest("hex");
      const directory=path.join(root,"storage/catalog-quarantine/private.png");
      await fs.mkdir(directory,{recursive:true}); await fs.writeFile(path.join(directory,digest),"corrupt recovery bytes");
      const before=await tx.select().from(products); const events=await tx.select().from(auditEvents);
      expect(await reconcileCatalogPublicCopies(tx,{apply:true,adapter})).toEqual([{key:"private.png",state:"failed",reason:"QUARANTINE_MISMATCH"}]);
      await expect(unpublishProduct(tx,id,"staff")).rejects.toMatchObject({statusCode:503});
      expect(await tx.select().from(products)).toEqual(before); expect(await tx.select().from(auditEvents)).toEqual(events);
      expect(await fs.readFile(path.join(root,"public/uploads/private.png"))).toEqual(publicBytes);
      expect((await adapter.readPrivate("private.png")).toString()).toBe("original");
      expect((await fs.readFile(path.join(directory,digest))).toString()).toBe("corrupt recovery bytes");
    });
  });
  it("retains quarantine across database rollback so an audit failure remains retryable", async () => {
    await withIsolatedTx(async tx => {
      const id=await seedPublication(tx); await publishProduct(tx,id,"staff"); await legacy();
      const before=await tx.select().from(products); const events=await tx.select().from(auditEvents);
      const failure=vi.spyOn(audit,"writeAudit").mockRejectedValueOnce(new Error("audit failure"));
      await expect(unpublishProduct(tx,id,"staff")).rejects.toThrow("audit failure"); failure.mockRestore();
      expect(await tx.select().from(products)).toEqual(before); expect(await tx.select().from(auditEvents)).toEqual(events);
      expect(await adapter.inspectPublic("private.png")).toBeNull();
      expect((await unpublishProduct(tx,id,"staff")).status).toBe("draft");
      const record=JSON.parse((await fs.readFile(path.join(root,"storage/catalog-quarantine/preservation.jsonl"),"utf8")).trim());
      expect((await fs.readFile(path.join(root,record.recoveryPath))).toString()).toBe("divergent legacy");
    });
  });
  it("surfaces preservation failure, keeps public bytes, reports unsuccessful remediation and retries", async () => {
    await withIsolatedTx(async tx => {
      await seedPublication(tx); await legacy();
      const failure=vi.spyOn(fs,"link").mockRejectedValueOnce(Object.assign(new Error("secret /private/path"),{code:"EACCES"}));
      const output: string[]=[];
      expect(await runCatalogReconciliation(tx,["--storage-root",root,"--apply"],value=>output.push(value))).toBe(1);
      expect(JSON.parse(output[0]).results).toEqual([{key:"private.png",state:"failed",reason:"PERMISSION_DENIED"}]);
      expect(output[0]).not.toContain("secret"); expect(output[0]).not.toContain("/private/path");
      expect(await adapter.inspectPublic("private.png")).not.toBeNull();
      expect((await adapter.readPrivate("private.png")).toString()).toBe("original");
      failure.mockRestore();
      expect(await runCatalogReconciliation(tx,["--storage-root",root,"--apply"],()=>{})).toBe(0);
    });
  });
});
