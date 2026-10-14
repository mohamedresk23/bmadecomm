import {describe,it,expect,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {drizzle} from "drizzle-orm/pglite";
import {randomUUID,randomBytes} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as schema from "../../db/schema";
import {setupCustomTestDb} from "../../test-utils/db";
import {issueStaffSession,resolveStaffSession} from "../../modules/identity/infrastructure/staff-sessions";
import {STAFF_SESSION_POLICY,staffConfig} from "../../modules/identity/infrastructure/staff-config";
import {sessionCsrf} from "../../modules/identity/infrastructure/staff-crypto";
import type {DbContext} from "../../db/tx";
import {LocalFileSystemAdapter} from "./storage";
const deployment=vi.hoisted(()=>({db:undefined as unknown,storage:undefined as unknown}));
vi.mock("../../db",()=>({get db(){return deployment.db;}}));
vi.mock("./storage",async importOriginal=>{
  const actual=await importOriginal<typeof import("./storage")>();
  return {...actual,get storage(){return deployment.storage;}};
});
import {POST as upload} from "../../app/api/media/upload/route";
import {POST as publish} from "../../app/api/media/publish/route";
describe("independent deployment DB authority",()=>{
  it("B handlers reject A credentials and cannot publish A media",async()=>{
    const clients=[new PGlite(),new PGlite()];
    const [a,b]=clients.map(client=>drizzle(client,{schema}));
    const root=await fs.mkdtemp(path.join(os.tmpdir(),"media-deployments-"));
    const aStorage=new LocalFileSystemAdapter(path.join(root,"a"));
    const bStorage=new LocalFileSystemAdapter(path.join(root,"b"));
    try {
      await Promise.all([setupCustomTestDb(a),setupCustomTestDb(b)]);
      const issue=async(database:typeof a)=>{
        const userId=randomUUID();
        await database.insert(schema.users).values({id:userId,email:`${userId}@example.test`,role:"staff",name:"fixture",phone:"01000000000",passwordHash:"fixture"});
        await database.insert(schema.staffAccounts).values({userId,mfaEnrolledAt:new Date(),mfaSeed:"fixture"});
        await database.insert(schema.roles).values({key:"owner"}).onConflictDoNothing();
        await database.insert(schema.userRoles).values({userId,roleKey:"owner"});
        const issued=await issueStaffSession(database as unknown as DbContext,userId,STAFF_SESSION_POLICY);
        if(!issued)throw new Error("Session fixture failed");return issued;
      };
      const [aSession,bSession]=await Promise.all([issue(a),issue(b)]);
      expect(await resolveStaffSession(b as unknown as DbContext,aSession.token,STAFF_SESSION_POLICY)).toBeNull();
      await a.insert(schema.media).values({id:"deploymenta",filename:"deploymenta.png",mimeType:"image/png",size:1,status:"pending"});
      await aStorage.savePrivate("deploymenta.png",Buffer.from("A"));
      deployment.db=b;deployment.storage=bStorage;
      vi.stubEnv("APP_URL","http://deployment-b.test");vi.stubEnv("STAFF_MFA_KEY",randomBytes(32).toString("base64"));
      const headers=(token:string)=>({Origin:staffConfig().origin,Cookie:`__Host-staff-session=${token}`,"X-CSRF-Token":sessionCsrf(token,staffConfig().key)});
      const stream=new ReadableStream<Uint8Array>({pull:()=>new Promise(()=>{})});
      const denied=new Request(`${staffConfig().origin}/api/media/upload`,{method:"POST",headers:headers(aSession.token),body:stream,duplex:"half"} as RequestInit);
      const reader=vi.spyOn(denied.body!,"getReader");
      expect((await upload(denied)).status).toBe(401);expect(denied.bodyUsed).toBe(false);expect(reader).not.toHaveBeenCalled();
      const resolution=vi.spyOn(bStorage,"publish");
      const req=new Request(`${staffConfig().origin}/api/media/publish`,{method:"POST",headers:{...headers(bSession.token),"Content-Type":"application/json"},body:JSON.stringify({id:"deploymenta"})});
      expect((await publish(req)).status).toBe(404);expect(resolution).not.toHaveBeenCalled();
      expect(await b.select().from(schema.media)).toEqual([]);
      expect((await fs.readFile(path.join(root,"a/storage/private/deploymenta.png"))).toString()).toBe("A");
    }finally{
      vi.restoreAllMocks();vi.unstubAllEnvs();await Promise.all(clients.map(client=>client.close()));
      if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))throw new Error("Unsafe fixture root");
      await fs.rm(root,{recursive:true,force:true});
    }
  },30000);
});
