import {afterEach,beforeAll,beforeEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {db} from "../../db";
import {media,productMedia,products} from "../../db/schema";
import {setupTestDb} from "../../test-utils/db";
import {LocalFileSystemAdapter,storage} from "./storage";
import {publishMedia} from "./upload";
let root:string;
let id:string;
let filename:string;
let adapter:LocalFileSystemAdapter;
beforeAll(setupTestDb);
beforeEach(async()=>{
  root=await fs.mkdtemp(path.join(os.tmpdir(),"media-publish-"));
  adapter=new LocalFileSystemAdapter(root);
  for(const method of ["publish","removePublic","recordOrphan"] as const) vi.spyOn(storage,method).mockImplementation(adapter[method].bind(adapter));
  id=randomUUID();filename=`${id}.png`;
  await adapter.savePrivate(filename,Buffer.from("private-fixture"));
  await adapter.savePrivate("historical.png",Buffer.from("retained"));
  await adapter.publish("historical.png");
  await db.insert(media).values({id,filename,mimeType:"image/png",size:15,status:"pending"});
});
afterEach(async()=>{
  vi.restoreAllMocks();
  await db.delete(productMedia).where(eq(productMedia.mediaId,id));
  await db.delete(products).where(eq(products.id,id));
  await db.delete(media).where(eq(media.id,id));
  if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)) throw new Error("Unsafe fixture root");
  await fs.rm(root,{recursive:true,force:true});
});
describe("real explicit publication and compensation",()=>{
  it.each(["published", "archived"])("allows media owned by a %s product",async(status)=>{
    await db.insert(products).values({id,name:"Publication fixture",status});
    await db.insert(productMedia).values({id,productId:id,mediaId:id,sortOrder:0});
    expect(await publishMedia(id)).toEqual({id,url:`/uploads/${filename}`});
    expect((await fs.readFile(path.join(root,"public/uploads",filename))).toString()).toBe("private-fixture");
    expect((await db.select().from(media).where(eq(media.id,id)))[0].status).toBe("active");
  });
  it("preserves missing media 404",async()=>{
    await expect(publishMedia(randomUUID())).rejects.toMatchObject({statusCode:404,message:"Media not found"});
    expect(storage.publish).not.toHaveBeenCalled();
  });
  it("publishes private bytes, activates row and remains idempotent",async()=>{
    expect(await publishMedia(id)).toEqual({id,url:`/uploads/${filename}`});
    expect((await fs.readFile(path.join(root,"public/uploads",filename))).toString()).toBe("private-fixture");
    expect((await fs.readFile(path.join(root,"storage/private",filename))).toString()).toBe("private-fixture");
    expect((await db.select().from(media).where(eq(media.id,id)))[0].status).toBe("active");
    expect(await publishMedia(id)).toEqual({id,url:`/uploads/${filename}`});
  });
  it("DB update failure removes only new public copy, preserving private and historical objects",async()=>{
    vi.spyOn(db,"update").mockImplementationOnce(()=>{throw new Error("injected DB failure");});
    await expect(publishMedia(id)).rejects.toMatchObject({statusCode:503});
    await expect(fs.stat(path.join(root,"public/uploads",filename))).rejects.toMatchObject({code:"ENOENT"});
    expect((await fs.readFile(path.join(root,"storage/private",filename))).toString()).toBe("private-fixture");
    expect((await fs.readFile(path.join(root,"public/uploads/historical.png"))).toString()).toBe("retained");
    expect((await db.select().from(media).where(eq(media.id,id)))[0].status).toBe("pending");
  });
  it("public collision preserves preexisting bytes and pending row",async()=>{
    await adapter.publish(filename);
    await expect(publishMedia(id)).rejects.toMatchObject({statusCode:503});
    expect((await fs.readFile(path.join(root,"public/uploads",filename))).toString()).toBe("private-fixture");
    expect((await db.select().from(media).where(eq(media.id,id)))[0].status).toBe("pending");
  });
});
