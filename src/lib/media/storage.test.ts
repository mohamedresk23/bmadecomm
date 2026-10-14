import {describe,it,expect,vi} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {LocalFileSystemAdapter} from "./storage";
describe("independent deployment media storage",()=>{
  it.each(["private","public"] as const)("compensates an owned %s file after close fails and records its location if cleanup fails",async location=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),"media-close-"));
    const adapter=new LocalFileSystemAdapter(root);
    try {
      await adapter.savePrivate("historical.png",Buffer.from("retained"));
      await adapter.publish("historical.png");
      if(location==="public") await adapter.savePrivate("new.png",Buffer.from("new"));
      const original=fs.open.bind(fs);
      vi.spyOn(fs,"open").mockImplementationOnce(async(...args)=>{
        const handle=await original(...args);
        vi.spyOn(handle,"close").mockRejectedValueOnce(new Error("injected close failure"));
        return handle;
      });
      const operation=()=>location==="private"?adapter.savePrivate("new.png",Buffer.from("new")):adapter.publish("new.png");
      await expect(operation()).rejects.toThrow("injected close failure");
      await expect(fs.stat(path.join(root,location==="private"?"storage/private":"public/uploads","new.png"))).rejects.toMatchObject({code:"ENOENT"});
      expect((await fs.readFile(path.join(root,"public/uploads/historical.png"))).toString()).toBe("retained");
      vi.restoreAllMocks();
      vi.spyOn(fs,"open").mockImplementationOnce(async(...args)=>{
        const handle=await original(...args);vi.spyOn(handle,"close").mockRejectedValueOnce(new Error("injected close failure"));return handle;
      });
      vi.spyOn(adapter,location==="private"?"removePrivate":"removePublic").mockRejectedValueOnce(new Error("cleanup failure"));
      await expect(operation()).rejects.toThrow("injected close failure");
      const log=JSON.parse((await fs.readFile(path.join(root,"storage/private/orphan-recovery.jsonl"),"utf8")).trim());
      expect(log).toMatchObject({key:"new.png",location});expect(Number.isFinite(Date.parse(log.time))).toBe(true);
      expect(Object.keys(log).sort()).toEqual(["key","location","time"]);
    }finally{
      vi.restoreAllMocks();
      if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)) throw new Error("Unsafe fixture root");
      await fs.rm(root,{recursive:true,force:true});
    }
  });
  it("does not resolve another deployment object and preserves existing keys",async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),"media-stores-"));
    const a=new LocalFileSystemAdapter(path.join(root,"a"));
    const b=new LocalFileSystemAdapter(path.join(root,"b"));
    try {
      await a.savePrivate("opaque.png",Buffer.from("original"));
      await expect(b.publish("opaque.png")).rejects.toMatchObject({code:"ENOENT"});
      await expect(a.savePrivate("opaque.png",Buffer.from("replacement"))).rejects.toMatchObject({code:"EEXIST"});
      expect((await fs.readFile(path.join(root,"a/storage/private/opaque.png"))).toString()).toBe("original");
      await expect(a.savePrivate("../opaque.png",Buffer.alloc(0))).rejects.toThrow("Invalid media key");
    } finally {
      if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)) throw new Error("Unsafe fixture root");
      await fs.rm(root,{recursive:true,force:true});
    }
  });
});
