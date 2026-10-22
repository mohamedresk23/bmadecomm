import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { auditEvents, media, productMedia, products, roles, slugRedirects, staffAccounts, userRoles, users } from "../../db/schema";
import { setupTestDb } from "../../test-utils/db";
import { seedPublication } from "../../test-utils/publication";
import { issueStaffSession } from "../../modules/identity/infrastructure/staff-sessions";
import { STAFF_SESSION_POLICY, staffConfig } from "../../modules/identity/infrastructure/staff-config";
import { encryptStaffSecret, newStaffSeed, sessionCsrf } from "../../modules/identity/infrastructure/staff-crypto";
import { POST as genericPublish } from "../../app/api/media/publish/route";
import { POST as publish } from "../../app/api/catalog/products/[id]/publish/route";
import { POST as unpublish } from "../../app/api/catalog/products/[id]/unpublish/route";
import { GET as publicProduct } from "../../app/api/public/products/by-slug/[slug]/route";
import { LocalFileSystemAdapter, storage } from "./storage";

let root: string, origin: string, token: string;
let adapter: LocalFileSystemAdapter;
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const request = new Request(`${staffConfig().origin}${incoming.url}`, { method: incoming.method, headers: incoming.headers as Record<string,string>, ...(incoming.method === "GET" ? {} : {body:Buffer.concat(chunks)}) });
    const pathname = new URL(request.url).pathname;
    const response = pathname === "/api/media/publish" ? await genericPublish(request)
      : pathname.startsWith("/api/public/") ? await publicProduct(request,{params:Promise.resolve({slug:pathname.split("/").at(-1)!})})
      : await (pathname.endsWith("/unpublish") ? unpublish : publish)(request,{params:Promise.resolve({id:"privacy-http"})});
    outgoing.writeHead(response.status,Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end(); }
});
beforeAll(async () => {
  vi.stubEnv("APP_URL","http://localhost:3000"); vi.stubEnv("STAFF_MFA_KEY",randomBytes(32).toString("base64"));
  await setupTestDb();
  root = await fs.mkdtemp(path.join(os.tmpdir(),"catalog-http-")); adapter = new LocalFileSystemAdapter(root);
  for (const method of ["publish","inspectPublic","quarantinePublic"] as const) vi.spyOn(storage,method).mockImplementation(adapter[method].bind(adapter));
  const userId = randomUUID();
  await db.insert(users).values({id:userId,name:"Privacy fixture",email:`${userId}@example.test`,phone:"01000000000",passwordHash:"fixture",role:"staff"});
  await db.insert(staffAccounts).values({userId,mfaSeed:encryptStaffSecret(newStaffSeed(),staffConfig().key,userId,"mfa"),mfaEnrolledAt:new Date()});
  await db.insert(roles).values({key:"owner"}).onConflictDoNothing(); await db.insert(userRoles).values({userId,roleKey:"owner"});
  const session = await issueStaffSession(db,userId,STAFF_SESSION_POLICY); if(!session) throw new Error("Session fixture failed"); token=session.token;
  await seedPublication(db,"privacy-http");
  await db.insert(media).values({id:"privacyhttpmedia",filename:"private.png",mimeType:"image/png",size:16,status:"pending"});
  await db.update(productMedia).set({mediaId:"privacyhttpmedia"}).where(eq(productMedia.productId,"privacy-http"));
  await db.delete(media).where(eq(media.id,"privacy-http-m"));
  await db.insert(slugRedirects).values({sourceSlug:"privacy-old",targetSlug:"privacy-http",productId:"privacy-http"});
  await adapter.savePrivate("private.png",Buffer.from("private original"));
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address(); if(!address || typeof address === "string") throw new Error("Server fixture failed"); origin=`http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  if(root){if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)) throw new Error("Unsafe fixture root"); await fs.rm(root,{recursive:true,force:true});}
});
async function post(route: string, body: object = {}) {
  return fetch(origin+route,{method:"POST",headers:{Cookie:`__Host-staff-session=${token}`,Origin:staffConfig().origin,"X-CSRF-Token":sessionCsrf(token,staffConfig().key),"Content-Type":"application/json"},body:JSON.stringify(body)});
}
it("enforces privacy through authenticated HTTP transitions, failure, retry and historical public URLs",async()=>{
  const base="/api/catalog/products/privacy-http";
  expect((await post(base+"/publish")).status).toBe(200);
  expect((await post("/api/media/publish",{id:"privacyhttpmedia"})).status).toBe(409);
  expect(storage.publish).not.toHaveBeenCalled();
  expect((await fetch(origin+"/api/public/products/by-slug/privacy-http")).status).toBe(200);
  expect((await fetch(origin+"/api/public/products/by-slug/privacy-old",{redirect:"manual"})).status).toBe(301);
  await adapter.publish("private.png"); await fs.writeFile(path.join(root,"public/uploads/private.png"),"legacy divergent public bytes");
  const history=await db.select().from(productMedia); const events=await db.select().from(auditEvents);
  const failure=vi.spyOn(adapter,"removePublic").mockRejectedValueOnce(new Error("disk secret"));
  const failed=await post(base+"/unpublish"); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("secret"); failure.mockRestore();
  expect((await db.select().from(products).where(eq(products.id,"privacy-http")))[0].status).toBe("published");
  expect(await db.select().from(auditEvents)).toEqual(events);
  expect((await post(base+"/unpublish")).status).toBe(200);
  expect((await post(base+"/unpublish")).status).toBe(200);
  expect((await post("/api/media/publish",{id:"privacyhttpmedia"})).status).toBe(409);
  for(const slug of ["privacy-http","privacy-old"]) expect((await fetch(origin+"/api/public/products/by-slug/"+slug,{redirect:"manual"})).status).toBe(404);
  expect(await adapter.inspectPublic("private.png")).toBeNull();
  expect((await adapter.readPrivate("private.png")).toString()).toBe("private original");
  const record=JSON.parse((await fs.readFile(path.join(root,"storage/catalog-quarantine/preservation.jsonl"),"utf8")).trim().split("\n").at(-1)!);
  expect((await fs.readFile(path.join(root,record.recoveryPath))).toString()).toBe("legacy divergent public bytes");
  expect(await db.select().from(productMedia)).toEqual(history);
});
